import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-control border border-transparent',
    'font-semibold leading-none transition-[background-color,border-color,color,transform,opacity] duration-100',
    'active:not-disabled:scale-[0.98] active:not-disabled:opacity-90',
    'disabled:cursor-not-allowed disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-ink text-on-ink shadow-xs hover:bg-[color-mix(in_oklab,var(--ink)_86%,var(--page))]',
        brand: 'bg-brand text-on-brand shadow-xs hover:bg-[color-mix(in_oklab,var(--brand)_88%,black)]',
        secondary: 'border-line-strong bg-surface text-ink shadow-xs hover:bg-surface-2',
        ghost: 'bg-transparent text-muted hover:bg-surface-2 hover:text-ink',
        danger:
          'border-[color-mix(in_oklab,var(--danger)_40%,var(--line))] bg-surface text-danger-ink hover:bg-danger-soft',
      },
      size: {
        sm: 'h-9 px-3 text-[13px] pointer-coarse:h-11 [&_svg]:size-4',
        md: 'h-11 px-4 text-[14px] [&_svg]:size-4',
        lg: 'h-13 px-5 text-[15px] [&_svg]:size-5',
        icon: 'size-11 px-0 [&_svg]:size-5',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      block: false,
    },
  },
)

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

function Button({ className, variant, size, block, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? 'primary'}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
