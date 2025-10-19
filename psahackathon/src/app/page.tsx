"use client";
import { db } from "@/lib/firebase";
import { collection, getDocs, addDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { useState, useEffect } from "react";
import { 
  AlertTriangle, 
  Activity, 
  Clock, 
  Users, 
  Search, 
  Filter,
  Plus,
  Brain,
  CheckCircle,
  AlertCircle,
  TrendingUp
} from "lucide-react";

// Types
type Severity = "Critical" | "High" | "Medium" | "Low";

interface Incident {
  id: string;
  title: string;
  module: string;
  severity: Severity;
  description: string;
  assignee?: string;
  status: "Open" | "In Progress" | "Resolved";
  containerId?: string;
  vessel?: string;
  createdAt: string;
}

interface ExtractedData {
  title: string;
  module: string;
  severity: Severity;
  description: string;
  assignee: string;
  containerId?: string | null;
  vessel?: string | null;
}

interface NewIncidentFormProps {
  rawInput: string;
  setRawInput: (s: string) => void;
  onCancel: () => void;
  onAnalyze: (severity: Severity) => void;
}

function LocalTime({ iso }: { iso: string }) {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    setTime(new Date(iso).toLocaleTimeString());
  }, [iso]);

  return <span>{time || "..."}</span>;
}

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case "Critical": return "bg-red-100 text-red-800 border-red-200";
    case "High": return "bg-orange-100 text-orange-800 border-orange-200";
    case "Medium": return "bg-yellow-100 text-yellow-800 border-yellow-200";
    default: return "bg-gray-100 text-gray-800 border-gray-200";
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case "Open": return <AlertCircle className="w-4 h-4 text-red-500" />;
    case "In Progress": return <Clock className="w-4 h-4 text-blue-500" />;
    case "Resolved": return <CheckCircle className="w-4 h-4 text-green-500" />;
    default: return <AlertCircle className="w-4 h-4 text-gray-500" />;
  }
};

function TimeDisplay({ timestamp }: { timestamp: string }) {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    try {
      setTime(new Date(timestamp).toLocaleTimeString());
    } catch {
      setTime(new Date(timestamp).toISOString().slice(11, 19));
    }
  }, [timestamp]);

  return <span>{time ?? "..."}</span>;
}

// Real log data based on actual application logs
const realLogEntries = [
  {
    timestamp: "2025-10-09T08:25:33.560Z",
    level: "INFO", 
    service: "api-repo",
    message: "Persist api_event_id=101 type=GATE_IN status=200 container_id=6",
    correlationId: "corr-api-0005"
  },
  {
    timestamp: "2025-10-04T12:25:10.529Z",
    level: "ERROR",
    service: "EDIService", 
    message: "code=EDI_ERR_1 msg=\"Segment missing\" sqlState=23000 sqlError=1062",
    correlationId: "ab72d0a1e9f8f9cd"
  },
  {
    timestamp: "2025-10-09T08:30:10.612Z",
    level: "WARN",
    service: "validation",
    message: "FlagStateChange frequency=HIGH vessel_id=7 last_change_minutes=3",
    correlationId: "vessel-reg-007"
  },
  {
    timestamp: "2025-10-09T08:25:34.112Z",
    level: "INFO",
    service: "http",
    message: "201 POST /events latency_ms=104",
    correlationId: "corr-api-0006"
  }
];

// Mock AI Suggestions Data with real log references
const mockAISuggestions = {
  "INC-2025-001": {
    similarIncidents: [
      {
        id: "INC-2024-892",
        title: "EDI COARRI validation failed - TEMU container",
        resolution: "Updated container validation rules in translator config",
        confidence: 0.89
      }
    ],
    recommendations: [
      "Check EDIFACT message segment structure for missing fields",
      "Verify message_ref uniqueness constraint in database", 
      "Restart EDI translator service with enhanced error handling"
    ],
    logAnalysis: [
      "ERROR EDIService code=EDI_ERR_1 msg=\"Segment missing\" at 12:25:10.529Z",
      "SQL constraint violation sqlError=1062 on uk_message_ref_error",
      "Pattern detected: 3 similar EDI errors in past 2 hours"
    ],
    logEntries: realLogEntries.filter(log => log.service.includes('EDI') || log.level === 'ERROR')
  },
  "INC-2025-002": {
    similarIncidents: [
      {
        id: "INC-2024-745", 
        title: "Connection pool exhausted during vessel surge",
        resolution: "Increased max connections from 50 to 100",
        confidence: 0.94
      }
    ],
    recommendations: [
      "Scale vessel registry connection pool immediately",
      "Implement vessel lookup caching for high frequency operations",
      "Add circuit breaker for vessel registry dependencies"
    ],
    logAnalysis: [
      "WARN validation FlagStateChange frequency=HIGH vessel_id=7",
      "High latency detected: POST /events latency_ms=104+",
      "Cache warmup shows only 20 vessels cached, insufficient for peak load"
    ],
    logEntries: realLogEntries.filter(log => log.service.includes('vessel') || log.message.includes('latency'))
  },
  "INC-2025-004": {
    similarIncidents: [
      {
        id: "INC-2024-623",
        title: "Vessel name collision during batch vessel advice import", 
        resolution: "Implemented vessel name deduplication workflow",
        confidence: 0.91
      }
    ],
    recommendations: [
      "Check active vessel advice records for duplicate system_vessel_name",
      "Implement vessel name validation before advice creation",
      "Consider vessel name versioning for operational vessels"
    ],
    logAnalysis: [
      "ERROR AdviceService code=VESSEL_ERR_4 msg=\"System Vessel Name has been used\"",
      "SQL constraint violation sqlError=1062 on uk_system_vessel_name_active", 
      "Duplicate vessel name: 'MV Lion City 07' already exists in ACTIVE state"
    ],
    logEntries: [
      {
        timestamp: "2025-10-08T09:14:12.419Z",
        level: "ERROR",
        service: "AdviceService",
        message: "code=VESSEL_ERR_4 msg=\"System Vessel Name has been used by other vessel advice\"",
        correlationId: "9fa2e7c1afad4d6a"
      },
      {
        timestamp: "2025-10-08T09:14:12.420Z", 
        level: "INFO",
        service: "AdviceController",
        message: "httpStatus=409 responseBody={\"code\":\"VESSEL_ERR_4\",\"message\":\"Local Vessel Name has been used by other vessel advice\"}",
        correlationId: "9fa2e7c1afad4d6a"
      }
    ]
  }
};

// AI Extraction
const simulateAIExtraction = (rawInput: string): ExtractedData => {
  const text = rawInput || "";
  const lower = text.toLowerCase();

  // Container ID pattern: 4 uppercase letters + 7 digits, e.g. CMAU0000020
  // We'll search case-insensitive
  const containerMatch =
    text.match(/[A-Z]{4}\d{7}/i) ?? text.match(/[a-z]{4}\d{7}/i);
  const containerId = containerMatch ? containerMatch[0].toUpperCase() : null;

  // Vessel / Voyage pattern: mv pacific dawn/07e  (loosely)
  // Allow "mv " optionally uppercase/lowercase
  const vesselMatch = text.match(/mv\s+[a-z0-9\s\-]+\s*\/\s*\d+[a-z]?/i);
  const vessel = vesselMatch ? vesselMatch[0] : null;

  // Module & Title heuristics via includes
  let module = "General";
  let title = "New Incident";

  if (lower.includes("vessel_err_4") || lower.includes("vessel advice")) {
    module = "Vessel Advice";
    title = vessel
      ? `Vessel Name Conflict - ${vessel}`
      : "Vessel Advice: Duplicate Name/Validation Error";
  } else if (lower.includes("cmau") || lower.includes("duplicate container")) {
    module = "Container Report";
    title = containerId
      ? `Duplicate Container ID ${containerId}`
      : "Container Report: Duplicate Container / ID Conflict";
  } else if (lower.includes("edi message") || lower.includes("ift-0007") || lower.includes("coarri") || lower.includes("edifact")) {
    module = "EDI/API";
    title = "EDI Message Stuck in Error";
  } else {
    // fallback - try smarter short summary
    if (lower.includes("connection pool") || lower.includes("connection exhausted")) {
      module = "Vessel";
      title = "Connection Pool Exhausted";
    } else {
      // generic short description from the first sentence
      const firstLine = text.split(/[\r\n]+/)[0] || text.slice(0, 80);
      title = firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
      module = "General";
    }
  }

  // Assignee extraction: attempt to find "To: Ops Team Duty; Jen" or "To: Jen" etc.
  let assignee = "Ops Team Duty";
  // attempt a few patterns
  const assigneePattern1 = text.match(/To:\s*Ops Team Duty;?\s*([A-Za-z]+)/i);
  const assigneePattern2 = text.match(/To:\s*([A-Za-z][A-Za-z\s]+)/i);
  const assigneePattern3 = text.match(/Assignee:\s*([A-Za-z][A-Za-z\s]+)/i);
  const mentionName = text.match(/\b(Jen|Vedu|Sarah|Mike|Alex|Chen|Chen Wei|Wei)\b/i);

  if (assigneePattern1 && assigneePattern1[1]) {
    assignee = assigneePattern1[1].trim();
  } else if (assigneePattern3 && assigneePattern3[1]) {
    assignee = assigneePattern3[1].trim();
  } else if (assigneePattern2 && assigneePattern2[1]) {
    // if it looks like a group or name, pick the last token
    const maybe = assigneePattern2[1].trim();
    // if it contains "Ops" probably group; prefer Ops Team Duty
    if (!/ops/i.test(maybe)) {
      assignee = maybe.split(/\s+/)[0];
    }
  } else if (mentionName && mentionName[0]) {
    assignee = mentionName[0];
  }

  return {
  title,
  module,
  severity: "Medium", // default or pick based on rules if you want
  description: rawInput,
  assignee,
  containerId,
  vessel,
};
};

// New Incident Form 
const NewIncidentForm: React.FC<NewIncidentFormProps> = ({
  rawInput,
  setRawInput,
  onCancel,
  onAnalyze,
}) => {
  const [severity, setSeverity] = useState<Severity>("Medium"); // sets Medium as defualt choice

  return (
    <div className="bg-white p-6 rounded-2xl shadow-lg space-y-4 w-full max-w-2xl mx-auto mt-8">
      <h2 className="text-2xl font-semibold">Create New Incident</h2>

      <textarea
        value={rawInput}
        onChange={(e) => setRawInput(e.target.value)}
        placeholder="Paste raw incident text here..."
        className="w-full h-48 border border-gray-300 rounded-xl p-3 focus:ring-2 focus:ring-blue-500"
      />

      {/* Severity Dropdown */}
      <div>
        <label className="block text-sm font-medium mb-2">Severity</label>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity)}
          className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500"
        >
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>

      <div className="flex justify-end space-x-3 pt-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300"
        >
          Cancel
        </button>
        <button
          onClick={() => onAnalyze(severity)}
          disabled={rawInput.length < 20}
          className="px-5 py-2 rounded-lg bg-blue-600 text-white font-medium disabled:bg-blue-300"
        >
          Analyze & Create Ticket
        </button>
      </div>
    </div>
  );
}

const deepSanitize = (obj: any): any => {
  if (obj === null || obj === undefined) return undefined;
  
  if (Array.isArray(obj)) {
    const arr = obj
      .map(deepSanitize)
      .filter((v) => v !== undefined);
    return arr.length > 0 ? arr : undefined;
  }

  if (obj instanceof Date) return obj;
  if (typeof obj === "object") {
    const sanitizedObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanValue = deepSanitize(value);
      if (cleanValue !== undefined) sanitizedObj[key] = cleanValue;
    }
    return Object.keys(sanitizedObj).length > 0 ? sanitizedObj : undefined;
  }

  if (["string", "number", "boolean"].includes(typeof obj)) return obj;

  return undefined;
};

let isSubmitting = false;

const deepSanitizeAndCreateIncident = async (newIncident: any) => {
  if (isSubmitting) return;
  isSubmitting = true;

  try {
    const cleanIncident = deepSanitize(newIncident);
    if (!cleanIncident) throw new Error("Incident data is empty or invalid");

    console.log("Writing sanitized incident:", cleanIncident);

    await addDoc(collection(db, "incidents"), {
      ...cleanIncident,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Firestore write error:", err);
  } finally {
    isSubmitting = false;
  }
};

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
useEffect(() => {
  const unsubscribe = onSnapshot(collection(db, "incidents"), snapshot => {
    const data: Incident[] = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        id: d.id,
        title: d.title,
        module: d.module,
        severity: d.severity,
        description: d.description,
        assignee: d.assignee,
        containerId: d.containerId,
        vessel: d.vessel,
        status: d.status,
        createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : d.createdAt
      };
    });
    setIncidents(data.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  });

  return () => unsubscribe();
}, []);

  // existing states
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [demoMode, setDemoMode] = useState(false);

  // new states
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [rawInput, setRawInput] = useState("");

  const [filters, setFilters] = useState({
    severity: "",
    status: "",
  });
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const filteredIncidents = incidents.filter(incident =>
    (incident.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    incident.module.toLowerCase().includes(searchTerm.toLowerCase())) &&
    (filters.severity ? incident.severity === filters.severity : true) &&
    (filters.status ? incident.status === filters.status : true)
  );

  // create next incident id (INC-YYYY-XXX)
  const getNextIncidentId = (): string => {
    const year = new Date().getFullYear();
    const nums = incidents.map((inc) => {
      const m = inc.id.match(/INC-\d{4}-(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    });
    const maxNum = nums.length ? Math.max(...nums) : 0;
    const next = maxNum + 1;
    const padded = String(next).padStart(3, "0");
    return `INC-${year}-${padded}`;
  };

  // handle analyze & create
  const handleAnalyzeAndCreate = async (severity: Severity) => {
  if (!rawInput || rawInput.length < 20) return;

  setLoading(true);

  try {
    const extracted = simulateAIExtraction(rawInput);
    const newId = getNextIncidentId();

    const response = await fetch("http://localhost:8000/pipeline/import-text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: rawInput }), // Send text payload
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();
    console.log("Extraction result:", data);

    const newIncident: Incident = {
      id: newId,
      title: extracted.title || "New Incident",
      module: extracted.module || "General",
      severity,
      description: rawInput,
      assignee: extracted.assignee || "Ops Team Duty",
      containerId: extracted.containerId || undefined,
      vessel: extracted.vessel || undefined,
      status: "Open",
      createdAt: new Date().toISOString(),
    };



    // 🔹 Use the deepSanitize version
    await deepSanitizeAndCreateIncident(newIncident);

    // 🔹 Update local state for immediate dashboard reflection
    setIncidents([newIncident, ...incidents]);
    setIsCreatingNew(false);
    setSelectedIncident(newId);
    setRawInput("");
  } catch (err) {
    console.error("Error during AI extraction or Firestore write:", err);
    alert("Error analyzing incident. Check console for details.");
  } finally {
    setLoading(false);
  }
};

  const selectedIncidentData = selectedIncident ? 
    incidents.find(inc => inc.id === selectedIncident) : null;
  
  const selectedIncidentSuggestions = selectedIncident ? 
    mockAISuggestions[selectedIncident as keyof typeof mockAISuggestions] : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Activity className="w-8 h-8 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-900">PORTNET</h1>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">AI Operations</span>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-xs text-green-600">Live</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => setDemoMode(!demoMode)}
                className={`px-3 py-1 rounded text-sm font-medium ${
                  demoMode ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {demoMode ? '🎯 Demo Mode ON' : 'Demo Mode'}
              </button>
              {demoMode && (
                <select 
                  className="px-2 py-1 text-xs border border-gray-300 rounded"
                  onChange={(e) => {
                    if (e.target.value) {
                      setSelectedIncident(e.target.value);
                    }
                  }}
                >
                  <option value="">Quick Demo Scenarios</option>
                  <option value="INC-2025-001">🔴 EDI Processing Failure</option>
                  <option value="INC-2025-002">🚨 Connection Pool Crisis</option>
                  <option value="INC-2025-004">⚠️ Vessel Name Conflict</option>
                </select>
              )}
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <Users className="w-4 h-4" />
              <span>Duty Officer: Alex Thompson</span>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="grid grid-cols-1 gap-6">
          {/* Key Metrics */}
          <div className="flex justify-evenly">
            <div className="flex items-center space-x-1">
              <AlertTriangle className="w-6 h-6 text-red-500" />
              <div>
                <p className="text-xl font-bold text-gray-900">3</p>
                <p className="text-xs text-gray-600">Active Incidents</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Brain className="w-6 h-6 text-purple-500" />
              <div>
                <p className="text-xl font-bold text-gray-900">0.89</p>
                <p className="text-xs text-gray-600">AI Confidence</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Clock className="w-6 h-6 text-blue-500" />
              <div>
                <p className="text-xl font-bold text-gray-900">12m</p>
                <p className="text-xs text-gray-600">Avg Resolution</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <TrendingUp className="w-6 h-6 text-green-500" />
              <div>
                <p className="text-xl font-bold text-gray-900">94%</p>
                <p className="text-xs text-gray-600">Auto-Resolved</p>
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* Main Content */}
      <div className="flex-1 p-6">
        {/* show NewIncidentForm if creating new */}
        {isCreatingNew ? (
          <NewIncidentForm
            rawInput={rawInput}
            setRawInput={setRawInput}
            onCancel={() => {
              setIsCreatingNew(false);
              setRawInput("");
            }}
            onAnalyze={handleAnalyzeAndCreate}
          />
          ) : !selectedIncident ? (
          /* Incidents List View */
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Active Incidents</h2>
              <button
                onClick={() => setIsCreatingNew(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md flex items-center space-x-2"
              >
                <Plus className="w-4 h-4" />
                <span>New Incident</span>
              </button>
            </div>
            
            {/* Search and Filters */}
            <div className="flex space-x-4 mb-6">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search incidents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Filter Button with Dropdown */}
              <div className="relative">
                <button
                onClick={() => setShowFilterMenu(!showFilterMenu)}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 flex items-center space-x-2">
                <Filter className="w-4 h-4" />
                <span>Filter</span>
              </button>

              {showFilterMenu && (
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg p-3 space-y-2 z-10">
                    <div>
                      <label className="text-xs text-gray-500">Severity</label>
                      <select
                        className="w-full border border-gray-300 rounded-md text-sm px-2 py-1 mt-1"
                        value={filters.severity}
                        onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
                      >
                        <option value="">All</option>
                        <option value="Critical">Critical</option>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Status</label>
                      <select
                        className="w-full border border-gray-300 rounded-md text-sm px-2 py-1 mt-1"
                        value={filters.status}
                        onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                      >
                        <option value="">All</option>
                        <option value="Open">Open</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Resolved">Resolved</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
            

            {/* Incidents List */}
            <div className="space-y-4">
              {filteredIncidents.map((incident) => (
                <div 
                  key={incident.id}
                  className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setSelectedIncident(incident.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        {getStatusIcon(incident.status)}
                        <h3 className="font-semibold text-gray-900">{incident.title}</h3>
                        <span className={`px-2 py-1 text-xs font-medium rounded border ${getSeverityColor(incident.severity)}`}>
                          {incident.severity}
                        </span>
                      </div>
                      
                      <p className="text-gray-600 text-sm mb-2">{incident.description}</p>
                      
                      <div className="flex items-center space-x-4 text-sm text-gray-500">
                        <span>#{incident.id}</span>
                        <span>{incident.module}</span>
                        <span>Assigned: {incident.assignee}</span>
                        <LocalTime iso={incident.createdAt} />
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <div className="flex items-center space-x-1">
                        <Brain className="w-4 h-4 text-purple-500" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          /* Incident Detail View */
          selectedIncidentData && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setSelectedIncident(null)}
                  className="text-blue-600 hover:text-blue-800 font-medium"
                >
                  ← Back to Incidents
                </button>
                <div className="flex items-center space-x-3">
                  <span className={`px-2 py-1 text-xs font-medium rounded border ${getSeverityColor(selectedIncidentData.severity)}`}>
                    {selectedIncidentData.severity}
                  </span>
                  <span className="text-sm text-gray-500">{selectedIncidentData.status}</span>
                </div>
              </div>

              {/* Incident Details */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">{selectedIncidentData.title}</h1>
                    <p className="text-gray-600 mb-4">{selectedIncidentData.description}</p>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <span>#{selectedIncidentData.id}</span>
                      <span>{selectedIncidentData.module}</span>
                      <span>Assigned: {selectedIncidentData.assignee}</span>
                      <LocalTime iso={selectedIncidentData.createdAt} />
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Brain className="w-5 h-5 text-purple-500" />
                    <span className="text-sm text-gray-500">AI Confidence</span>
                  </div>
                </div>
              </div>

              {/* AI Suggestions Panel */}
              {selectedIncidentSuggestions && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Similar Incidents */}
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">🔍 Similar Past Incidents</h3>
                    <div className="space-y-3">
                      {selectedIncidentSuggestions.similarIncidents.map((similar, index) => (
                        <div key={index} className="border-l-4 border-blue-500 pl-4 py-2">
                          <h4 className="font-medium text-gray-900">{similar.title}</h4>
                          <p className="text-sm text-gray-600 mb-1">{similar.resolution}</p>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs text-gray-500">#{similar.id}</span>
                            <span className="text-xs font-medium text-green-600">{Math.round(similar.confidence * 100)}% match</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* AI Recommendations */}
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">🤖 AI Recommendations</h3>
                    <div className="space-y-3">
                      {selectedIncidentSuggestions.recommendations.map((rec, index) => (
                        <div key={index} className="flex items-start space-x-3">
                          <div className="flex-shrink-0 w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center">
                            <span className="text-xs font-medium text-purple-600">{index + 1}</span>
                          </div>
                          <span className="text-sm text-gray-700">{rec}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 space-y-2">
                      <button className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded-md text-sm font-medium">
                        🤖 Apply AI Recommendations
                      </button>
                      <button className="w-full bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-md text-sm font-medium">
                        🚨 Escalate to L3/SME
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Log Analysis with Real Entries */}
              {selectedIncidentSuggestions && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {/* AI Log Analysis */}
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">🤖 AI Log Analysis</h3>
                    <div className="space-y-2">
                      {selectedIncidentSuggestions.logAnalysis.map((analysis, index) => (
                        <div key={index} className="flex items-start space-x-3 p-3 bg-orange-50 rounded border-l-4 border-orange-400">
                          <AlertCircle className="w-4 h-4 text-orange-500 mt-0.5" />
                          <span className="text-sm text-gray-700 font-mono">{analysis}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Real Log Entries */}
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">📋 Related Log Entries</h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {selectedIncidentSuggestions.logEntries?.map((logEntry, index) => (
                        <div key={index} className="p-3 bg-gray-900 text-white rounded font-mono text-xs">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="text-gray-400">{logEntry.timestamp}</span>
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              logEntry.level === 'ERROR' ? 'bg-red-600' :
                              logEntry.level === 'WARN' ? 'bg-yellow-600' :
                              'bg-blue-600'
                            }`}>
                              {logEntry.level}
                            </span>
                            <span className="text-blue-300">{logEntry.service}</span>
                          </div>
                          <div className="text-white text-wrap break-all">
                            {logEntry.message}
                          </div>
                          {logEntry.correlationId && (
                            <div className="text-xs text-gray-500 mt-1">
                              corrId: {logEntry.correlationId}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              {selectedIncidentSuggestions && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">🚀 Quick Actions</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <button className="bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-md text-sm font-medium flex items-center justify-center space-x-2">
                      <span>📊</span>
                      <span>View Full Logs</span>
                    </button>
                    <button className="bg-green-600 hover:bg-green-700 text-white py-3 px-4 rounded-md text-sm font-medium flex items-center justify-center space-x-2">
                      <span>✅</span>
                      <span>Mark as Resolved</span>
                    </button>
                    <button className="bg-purple-600 hover:bg-purple-700 text-white py-3 px-4 rounded-md text-sm font-medium flex items-center justify-center space-x-2">
                      <span>🔄</span>
                      <span>Run Diagnostics</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
