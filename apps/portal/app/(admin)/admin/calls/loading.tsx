import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-8 w-72" />
      {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-card" />)}
    </div>
  );
}
