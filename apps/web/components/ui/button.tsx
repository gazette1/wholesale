import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:bg-accent/90 shadow-sm",
        primary: "bg-brand text-white hover:bg-brand/90 shadow-sm",
        outline: "border border-border bg-surface hover:bg-surface-2 text-fg",
        ghost: "hover:bg-black/5 text-fg-2 hover:text-fg",
        danger: "bg-bad text-white hover:bg-bad/90",
        link: "text-brand underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3",
        lg: "h-10 px-4 text-sm",
        icon: "h-8 w-8",
        iconSm: "h-7 w-7",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { loading?: boolean };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
    {children}
  </button>
));
Button.displayName = "Button";

export { buttonVariants };
