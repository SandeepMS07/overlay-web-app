type IconProps = { title?: string };

const wrap = (path: React.ReactNode) =>
  function Icon({ title }: IconProps) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
        {title ? <title>{title}</title> : null}
        {path}
      </svg>
    );
  };

export const PinIcon = wrap(<path d="M5 4h14v2H5zm7 3l5 5h-3v7h-4v-7H7z" />);
export const GhostIcon = wrap(
  <path d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7zm0 3a4 4 0 100 8 4 4 0 000-8z" />
);
export const MinusIcon = wrap(<path d="M5 11h14v2H5z" />);
export const CloseIcon = wrap(
  <path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z" />
);
export const TrashIcon = wrap(<path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z" />);
export const SendIcon = wrap(<path d="M3 20V4l18 8zm2-3 10-5L5 7v3.5l6 1.5-6 1.5z" />);
export const StopIcon = wrap(<path d="M6 6h12v12H6z" />);
export const KeyIcon = wrap(
  <path d="M14 3a6 6 0 00-5.7 8L3 16.3V21h4.7l1.4-1.4V18h1.6l1.4-1.4v-1.7h1.2A6 6 0 1014 3zm2.4 5.2a1.6 1.6 0 110-3.2 1.6 1.6 0 010 3.2z" />
);
