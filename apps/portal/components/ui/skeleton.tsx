import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("lc-skeleton rounded-[var(--radius-input)]", className)}
      {...props}
    />
  )
}

export { Skeleton }
