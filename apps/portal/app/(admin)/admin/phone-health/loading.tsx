import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Page-body skeleton only — the gradient header + softphone live in the layout
// and stay rendered during navigation. Matches the phone-health page shape:
// a back-link + title block over a single table card.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <Card className="gap-3 p-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-64 w-full" />
      </Card>
    </div>
  );
}
