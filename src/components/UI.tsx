'use client';
import * as React from 'react';
import clsx from 'clsx';
import Link from 'next/link';



export function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {/* accent bar under title */}
      <div className="h-1 w-14 bg-indigo-600 rounded-full mt-2 mb-6"></div>
      {children}
    </div>
  );
}

type BreadcrumbProps = {
  steps: string[];
  current: number; // 0-based index of current step
  linkMap?: Record<string, string>; // e.g. { Project:'/projects', Personas:'/personas', Summary:'/sessions/summary' }
  className?: string;
};


type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'subtle';
  size?: 'sm' | 'md';
};

// src/components/UI.tsx (or wherever Button lives)
export function Button({
  className,
  variant = 'primary',
  size = 'md',
  type = 'button', // ✅ default to button
  ...rest
}: ButtonProps & { type?: 'button' | 'submit' | 'reset' }) {
  const sizes = size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm';
  const styles =
    variant === 'primary'
      ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-700/90'
      : variant === 'subtle'
      ? 'bg-gray-100 text-gray-900 hover:bg-gray-200'
      : 'border hover:bg-gray-50';

  return (
    <button
      type={type} // ✅ explicitly written
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center rounded-md transition',
        sizes,
        styles,
        className
      )}
    />
  );
}

export function Breadcrumb({ steps, current, linkMap, className }: BreadcrumbProps) {
  return (
    <nav className={clsx('mb-4 text-sm text-gray-600', className)} aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2">
        {steps.map((label, i) => {
          const href = linkMap?.[label];
          const isPast = i < current;
          const isCurrent = i === current;

          const item = isPast && href ? (
            <Link
              key={label}
              href={href}
              className="text-indigo-600 hover:underline"
            >
              {label}
            </Link>
          ) : (
            <span
              key={label}
              className={clsx(
                isCurrent ? 'font-medium text-gray-900' : 'text-gray-500'
              )}
            >
              {label}
            </span>
          );

          return (
            <React.Fragment key={label}>
              {i > 0 && <span className="text-gray-400">→</span>}
              {item}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-white border rounded-xl shadow-sm', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-medium text-gray-700">{children}</div>;
}

type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;
export function TextArea({ className, ...rest }: TextAreaProps) {
  return (
    <textarea
      {...rest}
      className={clsx(
        'w-full rounded-md border p-3 outline-none focus:ring-2 focus:ring-gray-300 min-h-[140px]',
        className
      )}
    />
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
export function Input({ className, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={clsx(
        'w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-gray-300',
        className
      )}
    />
  );
}

export function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4"
        checked={checked}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;
export function Select({ className, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      className={clsx('w-full rounded-md border p-2 focus:ring-2 focus:ring-gray-300', className)}
    />
  );
}

export function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min = 1,
  max = 5,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="grid gap-2">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
        className="w-full accent-black"
      />
      <div className="flex justify-between text-xs text-gray-600">
        <span>Low</span><span>Medium</span><span>High</span>
      </div>
    </div>
  );
}

export function Pill({ children, tone='gray' }: { children: React.ReactNode; tone?: 'gray'|'green'|'orange'|'blue' }) {
  const map = {
    gray: 'bg-gray-100 text-gray-800',
    green: 'bg-emerald-100 text-emerald-800',
    orange: 'bg-orange-100 text-orange-800',
    blue: 'bg-blue-100 text-blue-800',
  } as const;
  return <span className={clsx('text-xs px-2 py-1 rounded', map[tone])}>{children}</span>;
}

export function RadioCard({
  title,
  desc,
  selected,
  onClick,
}: {
  title: string;
  desc: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full text-left rounded-xl border p-4 hover:border-black transition hover:translate-y-[1px] hover:shadow-sm',
        selected ? 'ring-2 ring-black border-black' : 'border-gray-200'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="text-base font-medium">{title}</div>
        <div
          className={clsx(
            'size-4 rounded-full border',
            selected ? 'bg-black border-black' : 'bg-white border-gray-300'
          )}
        />
      </div>
      <div className="text-sm text-gray-600 mt-1">{desc}</div>
    </button>
  );
}