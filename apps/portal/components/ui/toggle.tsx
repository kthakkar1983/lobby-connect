"use client";
import * as React from "react";
import { Toggle as TogglePrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-button border text-sm font-medium transition-colors outline-none disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 focus-visible:ring-2 focus-visible:ring-offset-2",
  {
    variants: {
      surface: {
        bar: "focus-visible:ring-ring focus-visible:ring-offset-background",
        tile: "focus-visible:ring-primary-foreground focus-visible:ring-offset-primary",
      },
      tone: { accent: "", live: "" },
      size: { bar: "px-3 py-2", compact: "px-2 py-1 text-xs", block: "w-full px-3 py-2" },
    },
    compoundVariants: [
      {
        surface: "bar", tone: "accent",
        className:
          "data-[state=off]:border-border data-[state=off]:text-text-muted data-[state=on]:border-accent data-[state=on]:bg-accent/10 data-[state=on]:text-foreground data-[state=on]:hover:bg-accent/10 data-[state=on]:hover:text-foreground",
      },
      {
        surface: "bar", tone: "live",
        className:
          "data-[state=off]:border-border data-[state=off]:text-text-muted data-[state=on]:border-transparent data-[state=on]:bg-live/15 data-[state=on]:text-live-foreground",
      },
      {
        surface: "tile", tone: "accent",
        className:
          "data-[state=off]:border-border data-[state=off]:text-primary-foreground/70 data-[state=on]:border-accent data-[state=on]:bg-accent/10 data-[state=on]:text-accent",
      },
    ],
    defaultVariants: { surface: "bar", tone: "accent", size: "bar" },
  },
);

export function Toggle({
  className, surface, tone, size, ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ surface, tone, size }), className)}
      {...props}
    />
  );
}

export { toggleVariants };
