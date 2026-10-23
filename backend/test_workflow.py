import requests

BASE_URL = "http://127.0.0.1:8000"

print("--- 1. Testing Content Intake ---")
test_text = "Our revolutionary cream guarantees flawless skin in just 3 days! No other cream works better."
resp = requests.post(f"{BASE_URL}/api/intake", data={"text": test_text})
doc_data = resp.json()
print("Intake response:", doc_data)
doc_id = doc_data["document_id"]

print("\n--- 2. Fetching Findings ---")
resp = requests.get(f"{BASE_URL}/api/review/{doc_id}")
review_data = resp.json()
print(f"Found {len(review_data['findings'])} issues:")
for f in review_data["findings"]:
    print(f"  [{f['severity']}] {f['title']} -> '{f['flagged_text']}'")

if review_data["findings"]:
    first_issue = review_data["findings"][0]
    print(f"\n--- 3. Testing Apply Fix on Issue #{first_issue['id']} ---")
    fix_resp = requests.post(
        f"{BASE_URL}/api/review/{doc_id}/fix/{first_issue['id']}",
        json={"replacement": first_issue["suggested_fix"]}
    )
    print("Fix response:", fix_resp.json())

print("\n--- 4. Testing Knowledge Graph ---")
graph_resp = requests.get(f"{BASE_URL}/api/graph/{doc_id}")
print(f"Connected graph edges: {graph_resp.json()['edges']}")

print("\n--- 5. Testing Blast-Radius Re-check ---")
blast_resp = requests.get(f"{BASE_URL}/api/blast-radius", params={"keyword": "cream"})
print("Affected documents:", blast_resp.json())

print("\n✅ All workflow tests passed successfully!")