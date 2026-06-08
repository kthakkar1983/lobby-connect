"use client";

import { useEffect, useState } from "react";
import { greetingForHour } from "@lc/shared";

export function GreetingLine({ firstName }: { readonly firstName: string }) {
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);
  return (
    <h1 className="font-display text-2xl leading-tight text-foreground">
      {greeting}, {firstName}.
    </h1>
  );
}
