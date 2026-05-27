import { SHARED_PACKAGE_VERSION } from "@lc/shared";

export function App() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="rounded-lg border border-border bg-white p-12 text-center">
        <h1 className="text-3xl font-semibold">Lobby Connect Kiosk</h1>
        <p className="mt-3 text-sm opacity-70">
          Foundation OK · shared v{SHARED_PACKAGE_VERSION}
        </p>
      </div>
    </div>
  );
}
