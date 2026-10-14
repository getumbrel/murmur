import { create } from 'zustand'
import { Button } from '@/ui/button'
import { Sheet } from '@/ui/sheet'

// A yes/no question in a sheet: `if (await ask({...})) …`. Render <AskHost />
// once on any screen that asks.

type Question = {
  title: string
  body?: string
  action: string
  destructive?: boolean
  /** Just saying something: the one button, no Cancel. */
  notice?: boolean
}
type Pending = Question & { answer: (yes: boolean) => void }

const useAsk = create<{ pending: Pending | null; open: boolean }>(() => ({ pending: null, open: false }))

export function ask(q: Question): Promise<boolean> {
  useAsk.getState().pending?.answer(false)
  return new Promise((resolve) => useAsk.setState({ pending: { ...q, answer: resolve }, open: true }))
}

function close(yes: boolean) {
  useAsk.getState().pending?.answer(yes)
  // Keep the question around while the sheet animates out.
  useAsk.setState({ open: false })
}

export function AskHost() {
  const { pending, open } = useAsk()
  return (
    <Sheet open={open && !!pending} onOpenChange={(o) => !o && close(false)} title={pending?.title ?? ''} description={pending?.body} width={380}>
      <div className="grid gap-2 pt-2">
        <Button size="lg" variant={pending?.destructive ? 'danger' : 'accent'} onClick={() => close(true)}>
          {pending?.action}
        </Button>
        {!pending?.notice && (
          <Button size="lg" variant="ghost" className="text-ink-2" onClick={() => close(false)}>
            Cancel
          </Button>
        )}
      </div>
    </Sheet>
  )
}
