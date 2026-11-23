export default function LoadingPage() {
  return (
    <div className="px-4 py-6" role="status" aria-live="polite" data-route-loading>
      <p className="text-sm text-gray-500 dark:text-gray-400">Loading page…</p>
    </div>
  );
}
