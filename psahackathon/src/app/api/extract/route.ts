import { NextRequest, NextResponse } from "next/server";

interface ExtractResult {
  title: string;
  module: "EDI/API" | "Vessel Advice" | "Container Report" | "Vessel" | "General";
  containerId: string;
  vessel: string;
}

export async function POST(req: NextRequest) {
  try {
    const { rawInput } = await req.json();
    console.log("=== [DEBUG] Received raw input ===");
    console.log(rawInput);

    // Validate environment variables
    const endpointBase = process.env.AZURE_OPENAI_ENDPOINT;
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
    const apiKey = process.env.AZURE_OPENAI_KEY;

    if (!endpointBase || !deploymentName || !apiKey) {
      console.error("=== [DEBUG] Missing Azure OpenAI configuration ===");
      return NextResponse.json(
        { error: "Missing Azure OpenAI configuration" },
        { status: 500 }
      );
    }

    const endpoint = `${endpointBase}/openai/deployments/${deploymentName}/chat/completions?api-version=2023-07-01-preview`;
    console.log("=== [DEBUG] Using endpoint ===");
    console.log(endpoint);

    const payload = {
      messages: [
        {
          role: "system",
          content: `
You are an AI that extracts a short summary line from raw incident emails.
Return ONLY a JSON object with the fields:
- title: concise one-line summary
- module: one of ["EDI/API", "Vessel Advice", "Container Report", "Vessel", "General"]
- containerId: string, empty if missing
- vessel: string, empty if missing
Respond in valid JSON only.`
        },
        {
          role: "user",
          content: rawInput ?? ""
        }
      ],
      max_tokens: 200
    };
    console.log("=== [DEBUG] Payload being sent to AI ===");
    console.log(JSON.stringify(payload, null, 2));

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload)
    });

    console.log("=== [DEBUG] Fetch response status ===");
    console.log(res.status, res.statusText);

    const result = await res.json();
    console.log("=== [DEBUG] Raw AI response JSON ===");
    console.log(JSON.stringify(result, null, 2));

    const rawContent = result.choices?.[0]?.message?.content ?? "{}";
    console.log("=== [DEBUG] Raw AI text content ===");
    console.log(rawContent);

    // Strip triple backticks if present
    const jsonString = rawContent.replace(/```json|```/g, "").trim();
    console.log("=== [DEBUG] JSON string after cleanup ===");
    console.log(jsonString);

    let data: ExtractResult = {
      title: "Unable to extract summary",
      module: "General",
      containerId: "",
      vessel: ""
    };

    try {
      const parsed = JSON.parse(jsonString) as Partial<ExtractResult>;
      // Validate required fields
      if (parsed.title && parsed.module) {
        data = {
          title: parsed.title,
          module: parsed.module as ExtractResult["module"],
          containerId: parsed.containerId || "",
          vessel: parsed.vessel || ""
        };
      } else {
        console.warn("=== [DEBUG] AI JSON missing required fields ===");
      }
      console.log("=== [DEBUG] Parsed JSON object ===");
      console.log(data);
    } catch (err) {
      console.error("=== [DEBUG] Failed to parse AI JSON ===", err);
    }

    console.log("=== [DEBUG] Returning data ===");
    return NextResponse.json(data);
  } catch (error) {
    console.error("=== [DEBUG] AI Extraction Error ===", error);
    return NextResponse.json({ error: "Failed to extract data" }, { status: 500 });
  }
}