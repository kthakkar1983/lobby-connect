import { Skeleton } from "@/components/ui/skeleton";

export default function OwnerHomeLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Skeleton className="h-8 w-32" />
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-28 w-full rounded-lg" />
      ))}
    </div>
  );
}
