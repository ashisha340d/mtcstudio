import * as TooltipPrimitive from '@radix-ui/react-tooltip';

const YELLOW = '#FFE14D';
const EDGE = '#C9A400';

// Project-wide callout tooltip: yellow bubble, black text, arrow pointing at the target.
// <Tip text="…"><button/></Tip> — child must accept a ref (DOM element or forwardRef).
export default function Tip({ text, side = 'top', align = 'center', delay = 250, children }) {
  if (!text) return children;
  return (
    <TooltipPrimitive.Provider delayDuration={delay}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={8}
            style={{
              zIndex: 10000, maxWidth: 280, padding: '7px 10px', borderRadius: 6,
              background: YELLOW, color: '#000', border: `1px solid ${EDGE}`,
              fontSize: 12, fontWeight: 600, lineHeight: 1.4, textTransform: 'none', letterSpacing: 0,
              boxShadow: '0 4px 14px rgba(0,0,0,0.22)', whiteSpace: 'normal',
            }}
          >
            {text}
            <TooltipPrimitive.Arrow width={12} height={7} style={{ fill: YELLOW }} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
