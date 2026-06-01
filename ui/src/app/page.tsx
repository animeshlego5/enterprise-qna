import { QueryForm } from "@/components/QueryForm";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-zinc-950 px-4 py-20">
      <div className="mb-12 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-100">
          Enterprise QnA
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Ask questions answered from the knowledge base, powered by RAG + semantic cache.
        </p>
      </div>
      <QueryForm />
    </main>
  );
}
