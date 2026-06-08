import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Skeleton className="h-9 w-36" />
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-card" />
      ))}
    </div>
  );
}
