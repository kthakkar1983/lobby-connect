"use client";

import { useEffect, useState } from "react";
import { greetingForHour } from "@lc/shared";

export function Greeting() {
  // Neutral, stable first paint (matches SSR) → time-aware after mount.
  const [text, setText] = useState("Welcome back");
  useEffect(() => {
    setText(greetingForHour(new Date().getHours()));
  }, []);
  return <h1 className="font-display text-3xl leading-tight text-foreground">{text}</h1>;
}
