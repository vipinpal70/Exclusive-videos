/** "Powered by Partnex" credit, shared by the public page and the admin panel. */
export function PoweredBy({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[12px] leading-relaxed ${className}`}>
      Powered by{" "}
      <a href="https://partnex.in" target="_blank" rel="noopener" className="font-medium underline-offset-2 hover:underline">
        Partnex
      </a>{" "}
      · Exclusive content delivery
    </p>
  );
}
