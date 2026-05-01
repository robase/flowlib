'use client';

export default function Error() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-4">
      <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
      <a href="/docs" className="text-blue-500 hover:underline">
        Go to documentation
      </a>
    </div>
  );
}
