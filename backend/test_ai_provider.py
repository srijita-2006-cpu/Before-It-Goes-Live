import os
import unittest
from unittest.mock import Mock, patch

import ai_provider
import requests


def mocked_response(status_code, payload):
    response = Mock(status_code=status_code)
    response.headers = {}
    response.json.return_value = payload
    return response


def gemini_response(text, status_code=200):
    if status_code != 200:
        return mocked_response(status_code, {"error": {"status": "UNAVAILABLE"}})
    return mocked_response(
        status_code,
        {"candidates": [{"content": {"parts": [{"text": text}]}}]},
    )


def groq_response(text, status_code=200):
    if status_code != 200:
        return mocked_response(status_code, {"error": {"message": "provider unavailable"}})
    return mocked_response(
        status_code,
        {"choices": [{"message": {"content": text}}]},
    )


class AIProviderTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "GEMINI_API_KEY": "gemini-test-key",
            "GROQ_API_KEY": "groq-test-key",
            "AI_PRIMARY_PROVIDER": "gemini",
            "AI_FALLBACK_PROVIDER": "groq",
            "GEMINI_MODEL": ai_provider.DEFAULT_GEMINI_MODEL,
            "GROQ_MODEL": ai_provider.DEFAULT_GROQ_MODEL,
            "GEMINI_API_URL": ai_provider.DEFAULT_GEMINI_API_URL,
            "GROQ_API_URL": ai_provider.DEFAULT_GROQ_API_URL,
        })
        self.environment.start()

    def tearDown(self):
        self.environment.stop()

    def test_gemini_is_primary_when_both_keys_are_configured(self):
        with patch(
            "ai_provider.requests.post",
            return_value=gemini_response("Gemini answer"),
        ) as post:
            answer = ai_provider.generate([{"text": "Question"}], json_mode=False)

        self.assertEqual(answer, "Gemini answer")
        self.assertIn(ai_provider.DEFAULT_GEMINI_MODEL, post.call_args.args[0])
        self.assertEqual(post.call_args.kwargs["headers"]["x-goog-api-key"], "gemini-test-key")
        self.assertEqual(ai_provider.last_used_provider(), "gemini")

    def test_groq_fallback_runs_after_retryable_gemini_failure(self):
        with patch(
            "ai_provider.requests.post",
            side_effect=[
                gemini_response("", status_code=503),
                groq_response("Groq recovery"),
            ],
        ) as post:
            answer = ai_provider.generate([{"text": "Question"}], json_mode=False)

        self.assertEqual(answer, "Groq recovery")
        self.assertEqual(post.call_count, 2)
        groq_request = post.call_args_list[1]
        self.assertEqual(groq_request.args[0], ai_provider.DEFAULT_GROQ_API_URL)
        self.assertEqual(groq_request.kwargs["headers"]["Authorization"], "Bearer groq-test-key")
        self.assertEqual(groq_request.kwargs["json"]["model"], ai_provider.DEFAULT_GROQ_MODEL)
        self.assertEqual(ai_provider.last_used_provider(), "groq")

    def test_rate_limit_and_connection_errors_can_use_the_fallback(self):
        failures = [
            gemini_response("", status_code=429),
            requests.ConnectionError("offline"),
        ]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), patch(
                "ai_provider.requests.post",
                side_effect=[failure, groq_response("Recovered")],
            ):
                self.assertEqual(
                    ai_provider.generate([{"text": "Question"}], json_mode=False),
                    "Recovered",
                )

    def test_groq_is_used_when_its_key_is_the_only_key(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}), patch(
            "ai_provider.requests.post",
            return_value=groq_response("Groq only"),
        ) as post:
            answer = ai_provider.generate([{"text": "Question"}], json_mode=False)

        self.assertEqual(answer, "Groq only")
        self.assertEqual(post.call_args.args[0], ai_provider.DEFAULT_GROQ_API_URL)

    def test_gemini_is_used_when_its_key_is_the_only_key(self):
        with patch.dict(os.environ, {"GROQ_API_KEY": ""}), patch(
            "ai_provider.requests.post",
            return_value=gemini_response("Gemini only"),
        ) as post:
            answer = ai_provider.generate([{"text": "Question"}], json_mode=False)

        self.assertEqual(answer, "Gemini only")
        self.assertIn(ai_provider.DEFAULT_GEMINI_MODEL, post.call_args.args[0])

    def test_missing_keys_raise_clear_configuration_error(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "", "GROQ_API_KEY": ""}):
            with self.assertRaisesRegex(ai_provider.AIConfigurationError, "GEMINI_API_KEY.*GROQ_API_KEY"):
                ai_provider.generate([{"text": "Question"}])

    def test_both_providers_failing_raise_a_final_provider_error(self):
        with patch(
            "ai_provider.requests.post",
            side_effect=[
                gemini_response("", status_code=503),
                groq_response("", status_code=503),
            ],
        ):
            with self.assertRaises(ai_provider.AIProviderError) as raised:
                ai_provider.generate([{"text": "Question"}], raise_on_error=True)

        self.assertEqual(raised.exception.provider, "groq")
        self.assertEqual(raised.exception.status_code, 503)
        self.assertTrue(raised.exception.retryable)
        self.assertIn("temporarily unavailable", str(raised.exception))

    def test_invalid_gemini_json_falls_back_and_invalid_json_never_returns_as_success(self):
        with patch(
            "ai_provider.requests.post",
            side_effect=[
                gemini_response("not json"),
                groq_response('{"answer":"ok"}'),
            ],
        ) as post:
            answer = ai_provider.generate([{"text": "Return JSON"}])

        self.assertEqual(answer, '{"answer":"ok"}')
        self.assertEqual(post.call_count, 2)

        with patch(
            "ai_provider.requests.post",
            side_effect=[
                gemini_response("not json"),
                groq_response("also not json"),
            ],
        ):
            with self.assertRaises(ai_provider.AIProviderError) as raised:
                ai_provider.generate([{"text": "Return JSON"}], raise_on_error=True)
        self.assertEqual(raised.exception.provider_status, "INVALID_RESPONSE")
        self.assertIn("temporarily unavailable", str(raised.exception))

    def test_configured_provider_order_is_respected(self):
        with patch.dict(os.environ, {"AI_PRIMARY_PROVIDER": "groq", "AI_FALLBACK_PROVIDER": "gemini"}), patch(
            "ai_provider.requests.post",
            return_value=groq_response("Primary is Groq"),
        ) as post:
            answer = ai_provider.generate([{"text": "Question"}], json_mode=False)

        self.assertEqual(answer, "Primary is Groq")
        self.assertEqual(post.call_args.args[0], ai_provider.DEFAULT_GROQ_API_URL)

    def test_default_groq_model_supports_vision_and_strict_structured_output(self):
        schema = {
            "type": "OBJECT",
            "properties": {
                "transcription": {"type": "STRING"},
                "verified": {"type": "BOOLEAN"},
            },
            "required": ["transcription", "verified"],
        }
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}), patch(
            "ai_provider.requests.post",
            return_value=groq_response('{"transcription":"Visible copy","verified":true}'),
        ) as post:
            result = ai_provider.generate(
                [
                    {"text": "Transcribe visible copy."},
                    {"inlineData": {"mimeType": "image/png", "data": "aGVsbG8="}},
                ],
                response_schema=schema,
            )

        self.assertEqual(
            ai_provider.get_provider_config().groq_model,
            "qwen/qwen3.8-27b",
        )
        self.assertEqual(result, '{"transcription":"Visible copy","verified":true}')
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["model"], "qwen/qwen3.8-27b")
        self.assertEqual(
            payload["messages"][0]["content"][1]["image_url"]["url"],
            "data:image/png;base64,aGVsbG8=",
        )
        response_format = payload["response_format"]
        self.assertEqual(response_format["type"], "json_schema")
        self.assertTrue(response_format["json_schema"]["strict"])
        self.assertEqual(response_format["json_schema"]["schema"]["type"], "object")

    def test_groq_array_schema_is_wrapped_for_strict_output_and_normalized(self):
        schema = {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {"name": {"type": "STRING"}},
                "required": ["name"],
            },
        }
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}), patch(
            "ai_provider.requests.post",
            return_value=groq_response('{"items":[{"name":"candidate"}]}'),
        ) as post:
            result = ai_provider.generate(
                [{"text": "Return a JSON array."}],
                response_schema=schema,
                response_validator=lambda parsed: isinstance(parsed, list),
            )

        self.assertEqual(result, '[{"name": "candidate"}]')
        formatted = post.call_args.kwargs["json"]["response_format"]["json_schema"]["schema"]
        self.assertEqual(formatted["type"], "object")
        self.assertEqual(formatted["required"], ["items"])
        self.assertEqual(formatted["properties"]["items"]["type"], "array")
        self.assertIn("exactly one property named 'items'", post.call_args.kwargs["json"]["messages"][0]["content"][0]["text"])

    def test_invalid_provider_names_are_rejected(self):
        with patch.dict(os.environ, {"AI_PRIMARY_PROVIDER": "unknown"}):
            with self.assertRaisesRegex(ai_provider.AIConfigurationError, "AI_PRIMARY_PROVIDER"):
                ai_provider.get_provider_config()


if __name__ == "__main__":
    unittest.main()
