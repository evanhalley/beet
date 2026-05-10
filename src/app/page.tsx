import Image from "next/image";

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <section className="flex flex-col items-center gap-5 rounded-xl border border-[var(--color-border)] bg-white px-12 py-10 shadow-sm">
        <Image
          src="/beet-mark.svg"
          alt=""
          width={64}
          height={64}
          priority
        />
        <h1 className="text-3xl font-semibold tracking-tight">Beet 🫜</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          A glanceable GitHub dashboard.
        </p>
      </section>
    </main>
  );
}
