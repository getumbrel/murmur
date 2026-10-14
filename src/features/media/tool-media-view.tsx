import { RemoteImage, MediaBlock } from './blocks'

/** Images a tool made (e.g. a generated picture), shown under its step. */
export function ToolMedia({ items }: { items: string[] }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((m) =>
        /^(?:https?:|data:)/i.test(m) ? <RemoteImage key={m} src={m} /> : <MediaBlock key={m} path={m} />,
      )}
    </div>
  )
}
