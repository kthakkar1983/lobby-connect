import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex gap-4">
      <div className="flex flex-1 flex-col gap-3">
        <Card className="gap-2 p-5">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-40" />
        </Card>
        <div className="flex gap-3">
          <Skeleton className="h-16 flex-1 rounded-input" />
          <Skeleton className="h-16 flex-1 rounded-input" />
          <Skeleton className="h-16 flex-1 rounded-input" />
        </div>
        <Skeleton className="h-48 w-full rounded-card" />
      </div>
    </div>
  );
}
