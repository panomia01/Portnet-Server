To start the backend server locally, run the following command from your project root:

```
uvicorn app:app --reload --port 8000
```

This will start the FastAPI server on:

URL: http://localhost:8000

You should see output similar to:

```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [pid] using WatchFiles
```

Once the server is running, you can test the PDF upload endpoint using curl.
Run the following command in your terminal (update the PDF path if necessary):

```
curl -X POST http://localhost:8000/pipeline/import-pdf \
  -F 'file=@"/PATH/Test Cases.pdf";type=application/pdf'
```

If everything is set up correctly, you should get a JSON response like this:

```
{
  "ok": true,
  "count": 2,
  "results": [
    {
      "case": {
        "title": "Container Service Incident",
        "category": "CNTR",
        "signals": "CMAU0000020",
        "steps": "...",
        "expected": "...",
        "actual": "..."
      },
      "refers_to_logs": true,
      "matched_log_files": ["container_service.log"],
      "raw_model_decision": { "reason": "Matched CNTR pattern" }
    }
  ]
}
```

