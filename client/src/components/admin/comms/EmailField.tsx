/**
 * One inbox field that takes a comma-separated LIST of addresses.
 *
 * Hoisted out of any settings component on purpose (the cursor-jump bug): a
 * component type created inside a render is a NEW type every keystroke, so
 * React unmounted and remounted the input mid-word and focus fell to the top
 * of the section. Module scope = stable identity = the cursor stays where the
 * person is typing. The investor packet card in Admin edits two of the same
 * inboxes with the same field, through the export in CommsSettings.tsx.
 *
 * Light-only, like every admin surface.
 */
export function EmailField({ label, value, onChange, hint }: {
  label: string; value: string; onChange: (v: string) => void; hint: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700 block mb-1">
        {label}
        {/* type=text, not email: these fields take a comma-separated LIST so
            several people can receive updates, and the browser's single-email
            validation would fight that. */}
        <input
          type="text"
          inputMode="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-900 font-normal focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
          placeholder="one@example.org, two@example.org"
        />
      </label>
      <p className="text-xs text-gray-500 mt-1">{hint} Several people? Separate addresses with commas.</p>
    </div>
  );
}
