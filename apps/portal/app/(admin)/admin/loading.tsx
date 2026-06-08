import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-64" />
      <div className="flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 flex-1 rounded-input" />
        ))}
      </div>
      <Card className="gap-3 p-5">
        <Skeleton className="h-48 w-full" />
      </Card>
    </div>
  );
}
