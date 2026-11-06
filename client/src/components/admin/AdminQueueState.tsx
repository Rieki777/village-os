/**
 * The calm end of a list, and the plain words when a list does not load.
 *
 * "Done for tonight" shows once this device has already handled something
 * today and the queue is clear. A first visit with an empty queue says
 * nothing is waiting yet.
 */
import { handledOnThisDevice } from "./adminQueueState";

const TAP = "inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-base font-medium";

export default function AdminQueueState({
  kind,
  message,
  onRetry,
}: {
  kind: "empty" | "error";
  message?: string;
  onRetry?: () => void;
}) {
  if (kind === "error") {
    return (
      <div role="alert" className="py-12 text-center">
        <p className="text-base text-gray-900">{message || "The list did not load. Try again in a moment."}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className={`${TAP} mt-3 bg-teal-deep text-white`}>
            Try again
          </button>
        )}
      </div>
    );
  }
  const done = handledOnThisDevice() > 0;
  return (
    <div className="py-12 text-center">
      <p className="text-lg text-gray-900">{done ? "Done for tonight" : "Nothing is waiting yet"}</p>
      <p className="mt-1 text-base text-gray-600">
        {done ? "Nothing is waiting. It will keep until morning." : "New requests will show up here."}
      </p>
    </div>
  );
}
