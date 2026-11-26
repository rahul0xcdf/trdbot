import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="eyebrow justify-center">Not found</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Nothing here</h1>
      <p className="mt-2 text-sm text-ink-2">That snapshot or page doesn&apos;t exist.</p>
      <Link href="/" className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-bg">
        Back to Today
      </Link>
    </div>
  );
}
