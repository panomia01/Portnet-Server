import pandas as pd
import json
import requests
import re

# Azure OpenAI config
endpoint = "https://psacodesprint2025.azure-api.net"  
deployment_id = "gpt-4.1-mini"                  
api_version = "2025-01-01-preview"                   
api_key = "INSERT YOUR API KEY HERE"

url = f"{endpoint}/openai/deployments/{deployment_id}/chat/completions?api-version={api_version}"


headers = {
    "Content-Type": "application/json",
    "api-key": api_key
}

# Load Excel
df = pd.read_excel("Case Log.xlsx")

def categorize_incident(text):
    text = str(text).lower()
    categories = []

    if re.search(r'\bedi|edifact|codeco|coarri|segment|ack\b', text):
        categories.append("EDI_ERRORS")
    if re.search(r'\bmismatch|duplicate|inconsistent|drift|desync|out-of-order\b', text):
        categories.append("DATA_SYNC")
    if re.search(r'\btimeout|4\d\d|5\d\d|api|endpoint|request failed|gateway\b', text):
        categories.append("API_FAILURES")
    if re.search(r'\bvessel|voyage|berth|eta|schedule|overlap\b', text):
        categories.append("VESSEL_CONFLICTS")
    if re.search(r'\bfree day|policy|rule|link missing|booking|business\b', text):
        categories.append("BUSINESS_LOGIC")

    return categories if categories else None  # If None -> unknown


# AI fallback for unknown
def ask_ai(text):
    data = {
        "messages": [
            {"role": "system", "content": "You are a helpful incident categorization assistant."},
            {"role": "user", "content": f"Categorize this incident into one or more of: EDI_ERRORS, DATA_SYNC, API_FAILURES, VESSEL_CONFLICTS, BUSINESS_LOGIC. Incident text: {text}"}
        ],
        "max_tokens": 60
    }
    response = requests.post(url, headers=headers, data=json.dumps(data))
    if response.status_code == 200:
        try:
            choices = response.json().get("choices", [])
            if choices:
                content = choices[0]["message"]["content"]
                # Return a list of categories from AI (split by comma)
                return [c.strip() for c in content.split(",")]
        except Exception as e:
            print("AI response parsing error:", e)
    else:
        print(f"AI request error {response.status_code}: {response.text}")
    return ["UNKNOWN"]


df["Incident_Text"] = (
    df["Alert / Email"].fillna("") + " " +
    df["Problem Statements"].fillna("") + " " +
    df["Solution"].fillna("")
)

categories_list = []
for text in df["Incident_Text"]:
    categories = categorize_incident(text)
    if not categories:  # If unknown call AI
        categories = ask_ai(text)
    categories_list.append(", ".join(categories))

df["Category"] = categories_list

# Save results
df.to_excel("incident_case_log_categorized.xlsx", index=False)
print("Results saved to incident_case_log_categorized.xlsx")
