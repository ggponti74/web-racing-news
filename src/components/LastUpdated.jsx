const __UPDATE_TIMESTAMP__ = "2026-10-08T06:09:56Z";

export function LastUpdated() {
  const date = new Date(__UPDATE_TIMESTAMP__);
  if (Number.isNaN(date.getTime())) return null; // empty until the first run stamps it

  return <p class="last-updated">Last updated {date.toLocaleString()}</p>;
}
