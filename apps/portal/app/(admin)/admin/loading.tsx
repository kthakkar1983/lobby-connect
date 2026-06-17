import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Page-body skeleton only — the gradient header (greeting + account menu) and the
// softphone card live in the layout and stay rendered during navigation.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[4.5rem] rounded-card" />
        ))}
      </div>
      <Card className="gap-3 p-5">
        <Skeleton className="h-48 w-full" />
      </Card>
      <Card className="gap-3 p-5">
        <Skeleton className="h-40 w-full" />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 p-5">
          <Skeleton className="h-32 w-full" />
        </Card>
        <Card className="gap-3 p-5">
          <Skeleton className="h-32 w-full" />
        </Card>
      </div>
    </div>
  );
}
