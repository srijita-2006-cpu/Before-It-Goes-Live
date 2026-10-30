"""Shared configuration and provider dispatch for AI-backed features."""

import json
import logging
import os
import random
import time
from contextvars import ContextVar
from dataclasses import dataclass, replace
from typing import Any, Callable, Dict, List, Optional, Tuple, Union
from urllib.parse import urlparse

import requests

DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite"
DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b"
DEFAULT_GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
MAX_PROVIDER_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 0.5
logger = logging.getLogger("main")
_last_provider: ContextVar[Optional[str]] = ContextVar("last_ai_provider", default=None)


class AIConfigurationError(RuntimeError):
    """Raised when AI provider configuration is invalid or unavailable."""


class AIProviderError(RuntimeError):
    """A normalized error returned by an AI provider."""

    def __init__(
        self,
        provider: str,
        status_code: int,
        provider_status: str,
        message: str,
        retryable: Optional[bool] = None,
    ):
        super().__init__(message)
        self.provider = provider
        self.status_code = status_code
        self.provider_status = provider_status
        self.retryable = (
            retryable
            if retryable is not None
            else status_code in {408, 425, 429} or 500 <= status_code < 600
        )


@dataclass(frozen=True)
class ProviderConfig:
    primary_provider: str
    fallback_provider: str
    gemini_api_key: str
    groq_api_key: str
    gemini_model: str
    groq_model: str
    gemini_api_url: str
    groq_api_url: str

    def api_key(self, provider: str) -> str:
        return self.gemini_api_key if provider == "gemini" else self.groq_api_key

    def model(self, provider: str) -> str:
        return self.gemini_model if provider == "gemini" else self.groq_model

    def available_providers(self) -> List[str]:
        configured_order = [self.primary_provider, self.fallback_provider]
        return [provider for provider in configured_order if self.api_key(provider)]


def get_provider_config() -> ProviderConfig:
    primary = os.getenv("AI_PRIMARY_PROVIDER", "gemini").strip().lower()
    fallback = os.getenv("AI_FALLBACK_PROVIDER", "groq").strip().lower()
    supported = {"gemini", "groq"}
    if primary not in supported:
        raise AIConfigurationError(
            "AI_PRIMARY_PROVIDER must be either 'gemini' or 'groq'."
        )
    if fallback not in supported:
        raise AIConfigurationError(
            "AI_FALLBACK_PROVIDER must be either 'gemini' or 'groq'."
        )
    if primary == fallback:
        raise AIConfigurationError(
            "AI_PRIMARY_PROVIDER and AI_FALLBACK_PROVIDER must name different providers."
        )

    settings = {
        "GEMINI_MODEL": os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip(),
        "GROQ_MODEL": os.getenv("GROQ_MODEL", DEFAULT_GROQ_MODEL).strip(),
        "GEMINI_API_URL": os.getenv("GEMINI_API_URL", DEFAULT_GEMINI_API_URL).strip(),
        "GROQ_API_URL": os.getenv("GROQ_API_URL", DEFAULT_GROQ_API_URL).strip(),
    }
    empty_settings = [name for name, value in settings.items() if not value]
    if empty_settings:
        raise AIConfigurationError(
            "AI provider settings cannot be empty: " + ", ".join(empty_settings) + "."
        )
    for setting_name in ("GEMINI_API_URL", "GROQ_API_URL"):
        parsed_url = urlparse(settings[setting_name])
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            raise AIConfigurationError(
                f"{setting_name} must be a valid HTTP or HTTPS API URL."
            )

    return ProviderConfig(
        primary_provider=primary,
        fallback_provider=fallback,
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        groq_api_key=os.getenv("GROQ_API_KEY", "").strip(),
        gemini_model=settings["GEMINI_MODEL"],
        groq_model=settings["GROQ_MODEL"],
        gemini_api_url=settings["GEMINI_API_URL"].rstrip("/"),
        groq_api_url=settings["GROQ_API_URL"].rstrip("/"),
    )


def last_used_provider() -> Optional[str]:
    return _last_provider.get()


def _json_schema_for_groq(schema: Dict[str, Any]) -> Dict[str, Any]:
    type_names = {
        "OBJECT": "object",
        "ARRAY": "array",
        "STRING": "string",
        "INTEGER": "integer",
        "NUMBER": "number",
        "BOOLEAN": "boolean",
        "NULL": "null",
    }
    converted: Dict[str, Any] = {}
    for key, value in schema.items():
        if key == "type" and isinstance(value, str):
            converted[key] = type_names.get(value.upper(), value.lower())
        elif key == "type" and isinstance(value, list):
            converted[key] = [
                type_names.get(item.upper(), item.lower()) if isinstance(item, str) else item
                for item in value
            ]
        elif key == "properties" and isinstance(value, dict):
            converted[key] = {
                name: _json_schema_for_groq(child)
                for name, child in value.items()
                if isinstance(child, dict)
            }
        elif key == "items" and isinstance(value, dict):
            converted[key] = _json_schema_for_groq(value)
        elif key == "required" and isinstance(value, list):
            converted[key] = list(value)
        else:
            converted[key] = value
    if converted.get("type") == "object":
        converted["additionalProperties"] = False
        properties = converted.get("properties", {})
        converted["required"] = list(properties)
    return converted


def _groq_parts(parts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    content: List[Dict[str, Any]] = []
    for part in parts:
        text = part.get("text")
        if isinstance(text, str):
            content.append({"type": "text", "text": text})
            continue
        image = part.get("inlineData") or part.get("inline_data")
        if isinstance(image, dict):
            mime_type = image.get("mimeType") or image.get("mime_type") or "image/jpeg"
            image_data = image.get("data")
            if not isinstance(image_data, str) or not image_data:
                raise AIConfigurationError("An AI image request did not contain valid image data.")
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime_type};base64,{image_data}"},
            })
    if not content:
        raise AIConfigurationError("The AI request did not contain usable text or image content.")
    return content


def _response_matches_schema(value: Any, schema: Dict[str, Any]) -> bool:
    schema_type = schema.get("type")
    type_mapping = {
        "OBJECT": dict,
        "ARRAY": list,
        "STRING": str,
        "INTEGER": int,
        "NUMBER": (int, float),
        "BOOLEAN": bool,
        "NULL": type(None),
    }
    schema_types = schema_type if isinstance(schema_type, list) else [schema_type]
    normalized_types = {
        str(item).upper() for item in schema_types if item is not None
    }
    if isinstance(schema_type, list):
        expected_types = tuple(
            type_mapping[name] for name in normalized_types if name in type_mapping
        )
    else:
        expected = type_mapping.get(next(iter(normalized_types))) if normalized_types else None
        expected_types = (expected,) if expected is not None else ()
    if expected_types:
        if not isinstance(value, expected_types) or (
            isinstance(value, bool)
            and normalized_types.intersection({"INTEGER", "NUMBER"})
            and "BOOLEAN" not in normalized_types
        ):
            return False
    if "enum" in schema and value not in schema["enum"]:
        return False
    if isinstance(value, dict):
        required = schema.get("required", [])
        properties = schema.get("properties", {})
        if any(key not in value for key in required):
            return False
        return all(
            key not in properties or _response_matches_schema(item, properties[key])
            for key, item in value.items()
        )
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        return all(_response_matches_schema(item, schema["items"]) for item in value)
    return True


def _retry_delay(attempt: int, deadline: float) -> bool:
    base_delay = RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1))
    delay = base_delay + random.uniform(0, base_delay)
    if time.monotonic() + delay >= deadline:
        return False
    time.sleep(delay)
    return True


def _safe_retry_after(headers: Any) -> str:
    value = str(headers.get("Retry-After", "") if headers else "").strip()
    if not value:
        return "none"
    if value.replace(".", "", 1).isdigit():
        return f"{float(value):g}s"
    return "present"


def _groq_request(
    config: ProviderConfig,
    parts: List[Dict[str, Any]],
    json_mode: bool,
    timeout: Union[int, float, Tuple[float, float]],
    response_schema: Optional[Dict[str, Any]],
    retry_transient_503: bool,
    deadline: float,
    diagnostic_id: Optional[str],
) -> str:
    content = _groq_parts(parts)
    if json_mode and response_schema and response_schema.get("type") == "ARRAY":
        content.insert(0, {
            "type": "text",
            "text": (
                "For this API request, return a JSON object with exactly one property named "
                "'items'; its value must be the requested JSON array."
            ),
        })
    messages = [{"role": "user", "content": content}]
    payload: Dict[str, Any] = {
        "model": config.groq_model,
        "messages": messages,
        "temperature": 0.1,
        "max_completion_tokens": 8192,
    }
    if json_mode and response_schema:
        schema = response_schema
        if response_schema.get("type") == "ARRAY":
            schema = {
                "type": "OBJECT",
                "properties": {"items": response_schema},
                "required": ["items"],
            }
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "ai_response",
                "strict": True,
                "schema": _json_schema_for_groq(schema),
            },
        }
    elif json_mode:
        payload["response_format"] = {"type": "json_object"}

    max_attempts = MAX_PROVIDER_ATTEMPTS if retry_transient_503 else 1
    for attempt in range(1, max_attempts + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0.01:
            raise AIProviderError(
                "groq", 503, "REQUEST_DEADLINE",
                "The Groq request exceeded the AI request time budget.",
            )
        if isinstance(timeout, tuple):
            connect_timeout, read_timeout = timeout
        else:
            connect_timeout = min(float(timeout), remaining / 2)
            read_timeout = float(timeout)
        request_timeout = (
            min(float(connect_timeout), remaining / 2),
            max(0.001, min(float(read_timeout), remaining / 2)),
        )
        started = time.monotonic()
        try:
            response = requests.post(
                config.groq_api_url,
                json=payload,
                headers={"Authorization": f"Bearer {config.groq_api_key}"},
                timeout=request_timeout,
            )
            retry_after = _safe_retry_after(response.headers)
            if response.status_code != 200:
                retryable = (
                    response.status_code in {408, 425, 429}
                    or 500 <= response.status_code < 600
                )
                logger.warning(
                    "Groq request id=%s attempt=%d/%d upstream_http_status=%d "
                    "category=%s elapsed_ms=%d retry_after=%s",
                    diagnostic_id or "-",
                    attempt,
                    max_attempts,
                    response.status_code,
                    "rate_limited" if response.status_code == 429 else "upstream_error",
                    round((time.monotonic() - started) * 1000),
                    retry_after,
                )
                if (
                    retryable
                    and retry_transient_503
                    and attempt < max_attempts
                    and _retry_delay(attempt, deadline)
                ):
                    continue
                raise AIProviderError(
                    "groq",
                    response.status_code,
                    "UPSTREAM_ERROR",
                    "Groq did not complete the AI request.",
                    retryable=retryable,
                )
            try:
                data = response.json()
            except (TypeError, ValueError) as error:
                raise AIProviderError(
                    "groq", 502, "INVALID_RESPONSE",
                    "Groq returned an invalid response.", retryable=True,
                ) from error
            choices = data.get("choices", []) if isinstance(data, dict) else []
            if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                raise AIProviderError(
                    "groq", 502, "INVALID_RESPONSE",
                    "Groq returned an unusable response.", retryable=True,
                )
            message = choices[0].get("message", {})
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, str) or not content.strip():
                raise AIProviderError(
                    "groq", 502, "EMPTY_RESPONSE",
                    "Groq returned no usable AI response.", retryable=True,
                )
            logger.info(
                "Groq request id=%s attempt=%d/%d upstream_http_status=200 "
                "category=success elapsed_ms=%d",
                diagnostic_id or "-",
                attempt,
                max_attempts,
                round((time.monotonic() - started) * 1000),
            )
            return content
        except AIProviderError:
            raise
        except requests.RequestException as error:
            logger.warning(
                "Groq request id=%s attempt=%d/%d category=transport_error elapsed_ms=%d",
                diagnostic_id or "-",
                attempt,
                max_attempts,
                round((time.monotonic() - started) * 1000),
            )
            if (
                retry_transient_503
                and attempt < max_attempts
                and _retry_delay(attempt, deadline)
            ):
                continue
            raise AIProviderError(
                "groq", 503, "REQUEST_FAILED",
                "The Groq request failed or timed out.",
            ) from error
    raise AIProviderError(
        "groq", 503, "REQUEST_FAILED", "The Groq request failed."
    )


def _gemini_request(
    config: ProviderConfig,
    parts: List[Dict[str, Any]],
    json_mode: bool,
    timeout: Union[int, float, Tuple[float, float]],
    response_schema: Optional[Dict[str, Any]],
    retry_transient_503: bool,
    deadline: float,
    diagnostic_id: Optional[str],
) -> str:
    generation_config: Dict[str, Any] = {
        "temperature": 0.1,
        "maxOutputTokens": 8192,
    }
    if json_mode:
        generation_config["responseMimeType"] = "application/json"
        if response_schema:
            generation_config["responseSchema"] = response_schema
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": generation_config,
    }
    max_attempts = MAX_PROVIDER_ATTEMPTS if retry_transient_503 else 1
    url = f"{config.gemini_api_url}/{config.gemini_model}:generateContent"
    for attempt in range(1, max_attempts + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0.01:
            raise AIProviderError(
                "gemini", 503, "REQUEST_DEADLINE",
                "The Gemini request exceeded the AI request time budget.",
            )
        if isinstance(timeout, tuple):
            connect_timeout = min(float(timeout[0]), remaining / 2)
            read_timeout = min(float(timeout[1]), max(0.001, remaining - connect_timeout))
        else:
            connect_timeout = min(float(timeout), remaining / 2)
            read_timeout = min(float(timeout), max(0.001, remaining - connect_timeout))
        started = time.monotonic()
        try:
            response = requests.post(
                url,
                json=payload,
                headers={"x-goog-api-key": config.gemini_api_key},
                timeout=(connect_timeout, read_timeout),
            )
            if response.status_code != 200:
                retryable = (
                    response.status_code in {408, 425, 429}
                    or 500 <= response.status_code < 600
                )
                logger.warning(
                    "Gemini request id=%s attempt=%d/%d upstream_http_status=%d "
                    "category=%s elapsed_ms=%d retry_after=%s",
                    diagnostic_id or "-",
                    attempt,
                    max_attempts,
                    response.status_code,
                    "rate_limited" if response.status_code == 429 else "upstream_error",
                    round((time.monotonic() - started) * 1000),
                    response.headers.get("Retry-After", "none"),
                )
                if (
                    retryable
                    and retry_transient_503
                    and attempt < max_attempts
                    and _retry_delay(attempt, deadline)
                ):
                    continue
                raise AIProviderError(
                    "gemini",
                    response.status_code,
                    "UPSTREAM_ERROR",
                    "Gemini did not complete the AI request.",
                    retryable=retryable,
                )
            data = response.json()
            candidates = data.get("candidates", []) if isinstance(data, dict) else []
            response_parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
            text = response_parts[0].get("text") if response_parts else None
            if not isinstance(text, str) or not text.strip():
                raise AIProviderError(
                    "gemini", 502, "EMPTY_RESPONSE",
                    "Gemini returned no usable AI response.", retryable=True,
                )
            return text
        except AIProviderError:
            raise
        except requests.RequestException as error:
            logger.warning(
                "Gemini request id=%s attempt=%d/%d category=transport_error elapsed_ms=%d",
                diagnostic_id or "-",
                attempt,
                max_attempts,
                round((time.monotonic() - started) * 1000),
            )
            if (
                retry_transient_503
                and attempt < max_attempts
                and _retry_delay(attempt, deadline)
            ):
                continue
            raise AIProviderError(
                "gemini", 503, "REQUEST_FAILED",
                "The Gemini request failed or timed out.",
            ) from error
        except (TypeError, ValueError) as error:
            raise AIProviderError(
                "gemini", 502, "INVALID_RESPONSE",
                "Gemini returned an invalid response.", retryable=True,
            ) from error
    raise AIProviderError(
        "gemini", 503, "REQUEST_FAILED", "The Gemini request failed."
    )


def generate(
    parts: List[Dict[str, Any]],
    gemini_call: Optional[Callable[..., Optional[str]]] = None,
    json_mode: bool = True,
    timeout: Union[int, float, Tuple[float, float]] = 50,
    response_schema: Optional[Dict[str, Any]] = None,
    raise_on_error: bool = False,
    retry_transient_503: bool = False,
    overall_timeout: Optional[float] = None,
    diagnostic_id: Optional[str] = None,
    api_key_override: Optional[str] = None,
    response_validator: Optional[Callable[[Any], bool]] = None,
) -> Optional[str]:
    config = get_provider_config()
    if api_key_override and api_key_override.strip():
        config = replace(config, gemini_api_key=api_key_override.strip())
    providers = config.available_providers()
    if not providers:
        raise AIConfigurationError(
            "No AI provider API key is configured. Add GEMINI_API_KEY and/or "
            "GROQ_API_KEY to backend\\.env, then restart the backend."
        )

    if overall_timeout is not None:
        budget = float(overall_timeout)
    elif isinstance(timeout, tuple):
        budget = float(timeout[0]) + float(timeout[1])
    else:
        budget = float(timeout)
    deadline = time.monotonic() + budget
    last_error: Optional[AIProviderError] = None

    for index, provider in enumerate(providers):
        remaining = deadline - time.monotonic()
        if remaining <= 0.01:
            last_error = AIProviderError(
                provider, 503, "REQUEST_DEADLINE",
                "AI generation exceeded its time budget.",
            )
            break
        try:
            if provider == "gemini":
                provider_timeout = timeout
                if isinstance(timeout, tuple):
                    connect_timeout = min(float(timeout[0]), remaining / 2)
                    read_timeout = min(float(timeout[1]), max(0.001, remaining - connect_timeout))
                    provider_timeout = (connect_timeout, read_timeout)
                else:
                    provider_timeout = min(float(timeout), remaining)
                if gemini_call:
                    gemini_schema = (
                        None
                        if response_schema and response_schema.get("type") == "ARRAY"
                        else response_schema
                    )
                    raw = gemini_call(
                        parts,
                        json_mode=json_mode,
                        timeout=provider_timeout,
                        response_schema=gemini_schema,
                        raise_on_error=True,
                        retry_transient_503=retry_transient_503,
                        overall_timeout=remaining if overall_timeout is not None else None,
                        diagnostic_id=diagnostic_id,
                        api_key=config.gemini_api_key,
                        model=config.gemini_model,
                        api_url=config.gemini_api_url,
                    )
                else:
                    gemini_schema = (
                        None
                        if response_schema and response_schema.get("type") == "ARRAY"
                        else response_schema
                    )
                    raw = _gemini_request(
                        config,
                        parts,
                        json_mode,
                        provider_timeout,
                        gemini_schema,
                        retry_transient_503,
                        deadline,
                        diagnostic_id,
                    )
            else:
                raw = _groq_request(
                    config,
                    parts,
                    json_mode,
                    timeout,
                    response_schema,
                    retry_transient_503,
                    deadline,
                    diagnostic_id,
                )
                if json_mode and response_schema and response_schema.get("type") == "ARRAY":
                    try:
                        wrapped = json.loads(raw)
                    except (TypeError, ValueError) as error:
                        raise AIProviderError(
                            provider, 502, "INVALID_RESPONSE",
                            "Groq returned invalid JSON for a structured array response.",
                            retryable=True,
                        ) from error
                    if not isinstance(wrapped, dict) or not isinstance(wrapped.get("items"), list):
                        raise AIProviderError(
                            provider, 502, "INVALID_RESPONSE",
                            "Groq did not return the required structured array.",
                            retryable=True,
                        )
                    raw = json.dumps(wrapped["items"], ensure_ascii=False)
            if not isinstance(raw, str) or not raw.strip():
                raise AIProviderError(
                    provider, 502, "EMPTY_RESPONSE",
                    f"{provider.title()} returned no usable AI response.",
                    retryable=True,
                )
            if json_mode:
                try:
                    parsed = json.loads(raw)
                except (TypeError, ValueError) as error:
                    raise AIProviderError(
                        provider, 502, "INVALID_RESPONSE",
                        f"{provider.title()} returned invalid JSON.",
                        retryable=True,
                    ) from error
                if response_schema and not _response_matches_schema(parsed, response_schema):
                    raise AIProviderError(
                        provider, 502, "INVALID_RESPONSE",
                        f"{provider.title()} returned JSON that did not match the required response schema.",
                        retryable=True,
                    )
                if response_validator and not response_validator(parsed):
                    raise AIProviderError(
                        provider, 502, "INVALID_RESPONSE",
                        f"{provider.title()} returned an unusable JSON response.",
                        retryable=True,
                    )
            _last_provider.set(provider)
            return raw
        except AIConfigurationError:
            raise
        except AIProviderError as error:
            last_error = error
            if not error.retryable or index == len(providers) - 1:
                break
            logger.warning(
                "AI provider=%s failed with a retryable error; trying configured fallback provider=%s",
                provider,
                providers[index + 1],
            )
        except (requests.Timeout, requests.ConnectionError) as error:
            last_error = AIProviderError(
                provider, 503, "REQUEST_FAILED",
                f"The {provider.title()} request failed or timed out.",
            )
            if index == len(providers) - 1:
                break
            logger.warning(
                "AI provider=%s transport failed; trying configured fallback provider=%s",
                provider,
                providers[index + 1],
            )

    _last_provider.set(None)
    if raise_on_error:
        if last_error:
            if last_error.retryable:
                raise AIProviderError(
                    last_error.provider,
                    last_error.status_code,
                    last_error.provider_status,
                    "AI generation is temporarily unavailable from the configured providers.",
                    retryable=True,
                ) from last_error
            raise last_error
        raise AIProviderError(
            providers[-1], 503, "REQUEST_FAILED",
            "AI generation is temporarily unavailable.",
        )
    return None
