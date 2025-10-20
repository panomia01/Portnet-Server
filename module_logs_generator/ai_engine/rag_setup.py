from pathlib import Path
import pandas as pd
from docx import Document
import requests
import json
import chromadb
from chromadb.utils import embedding_functions

# config
ENDPOINT = "https://psacodesprint2025.azure-api.net"
DEPLOYMENT_ID = "text-embedding-3-small"
API_VERSION = "2023-05-15"
API_KEY = "ae8ca593ce0e4bf983cd8730fbc15df4"

BASE_DIR = Path(__file__).resolve().parent

CHROMA_PATH = BASE_DIR / "chroma_db"
COLLECTION_NAME = "incident_kb"

EXCEL_FILE = BASE_DIR / "incident_case_log_categorized.xlsx"
WORD_FILE = BASE_DIR / "Knowledge Base.docx"


def get_embedding(text):
    url = f"{ENDPOINT}/openai/deployments/{DEPLOYMENT_ID}/embeddings?api-version={API_VERSION}"
    headers = {
        "Content-Type": "application/json",
        "api-key": API_KEY
    }
    data = {"input": text, "user": "psa-hackathon"}
    response = requests.post(url, headers=headers, data=json.dumps(data))
    response.raise_for_status()
    return response.json()["data"][0]["embedding"]

# wrap to chroma embedding
azure_ef = embedding_functions.OpenAIEmbeddingFunction(
    api_key=API_KEY,
    api_base=ENDPOINT,
    api_type="azure",
    api_version=API_VERSION,
    deployment_id=DEPLOYMENT_ID,
    model_name="text-embedding-3-small",  
)

def ingest_knowledge_base():
    # initialise chroma
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    collection = client.get_or_create_collection(COLLECTION_NAME, embedding_function=azure_ef)
    print("Collection ready:", collection.name)

    # process excel file
    df = pd.read_excel(EXCEL_FILE)
    df["Incident_Text"] = (
        df["Alert / Email"].fillna("") + " " +
        df["Problem Statements"].fillna("") + " " +
        df["Solution"].fillna("")
    )

    for idx, row in df.iterrows():
        collection.add(
            documents=[row["Incident_Text"]],
            metadatas=[{
                "source": "excel",
                "category": row.get("Category"),
                "incident_id": idx
            }],
            ids=[f"incident_{idx}"]
        )

    # process doc file 
    doc = Document(WORD_FILE)
    kb_text = "\n".join([p.text for p in doc.paragraphs if p.text.strip()])

    chunk_size = 500
    chunk_overlap = 50
    start = 0
    i = 0
    while start < len(kb_text):
        end = min(start + chunk_size, len(kb_text))
        chunk = kb_text[start:end]
        collection.add(
            documents=[chunk],
            metadatas=[{"source": "kb_doc","category": "GENERAL_GUIDELINES"}],
            ids=[f"kb_{i}"]
        )
        start += chunk_size - chunk_overlap
        i += 1


def RAG_chunk_data_producer(query:str):
    client = chromadb.PersistentClient(path=CHROMA_PATH)

    collections = [c.name for c in client.list_collections()]
    if COLLECTION_NAME not in collections:
        print(f"Collection '{COLLECTION_NAME}' not found. Running ingest_knowledge_base()...")
        ingest_knowledge_base()

    collection = client.get_collection(COLLECTION_NAME, embedding_function=azure_ef)
    results = collection.query(query_texts=[query], n_results=5)

    # gather context
    combined_context = "\n\n".join(results["documents"][0])
    sources = [meta.get("source", "unknown") for meta in results["metadatas"][0]]

    prompt = f"""
    Given the following context from incident logs and knowledge base, 
    provide short actionable bullet-point suggestions to resolve this issue:

    Issue: {query}

    Context:
    {combined_context}

    Make the suggestions concise but specific (2-4 bullet points).
    """

    data = {
        "messages": [
            {"role": "system", "content": "You are an experienced L2 support engineer providing troubleshooting suggestions."},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 250
    }

    url = f"{ENDPOINT}/openai/deployments/gpt-4.1-mini/chat/completions?api-version=2025-01-01-preview"
    resp = requests.post(url, headers={"Content-Type": "application/json", "api-key": API_KEY}, data=json.dumps(data))
    rag_output = resp.json()["choices"][0]["message"]["content"]
    return {
        "rag_suggestion": rag_output.strip(),
        "rag_sources": sources
    }