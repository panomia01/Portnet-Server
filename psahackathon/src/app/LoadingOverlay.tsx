// LoadingOverlay.tsx
export function LoadingOverlay({
  open, steps, onCancel,
}: {
  open: boolean;
  steps: { label: string; done: boolean }[];
  onCancel?: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[999] bg-black/30 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse" />
          <h3 className="font-semibold">Analyzing incident…</h3>
        </div>
        <ul className="space-y-2 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center">
              <span className={`mr-2 w-5 h-5 rounded-full border flex items-center justify-center ${
                s.done ? "bg-green-100 border-green-400" : "bg-gray-100 border-gray-300 animate-pulse"
              }`}>{s.done ? "✓" : ""}</span>
              {s.label}
            </li>
          ))}
        </ul>
        {onCancel && (
          <button onClick={onCancel} className="mt-4 text-sm underline text-gray-600">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
