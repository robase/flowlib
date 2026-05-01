import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-4">
      <h2 className="text-2xl font-bold mb-4">Page not found</h2>
      <Link href="/docs" className="text-blue-500 hover:underline">
        Go to documentation
      </Link>
    </div>
  );
}
