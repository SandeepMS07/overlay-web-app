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
export const MicIcon = wrap(
  <path d="M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V21h-2v-3.1A7 7 0 015 11z" />
);
/** A small machine: the model runs here rather than on someone's server. */
export const ChipIcon = wrap(
  <path d="M9 2h1.6v2H13V2h1.6v2H16a2 2 0 012 2v1.4h2V9h-2v2.2h2v1.6h-2V15h2v1.6h-2V18a2 2 0 01-2 2h-1.4v2H13v-2h-2.4v2H9v-2H8a2 2 0 01-2-2v-1.4H4V15h2v-2.2H4v-1.6h2V9H4V7.4h2V6a2 2 0 012-2h1zM8 6v12h8V6zm2 2h4v4h-4z" />
);
export const GlobeIcon = wrap(
  <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm6.9 9h-3a15.7 15.7 0 00-1.4-6 8 8 0 014.4 6zM12 4.1A13.6 13.6 0 0113.9 11h-3.8A13.6 13.6 0 0112 4.1zM4.1 11a8 8 0 014.4-6 15.7 15.7 0 00-1.4 6zm0 2h3a15.7 15.7 0 001.4 6 8 8 0 01-4.4-6zm5.9 0h3.8A13.6 13.6 0 0112 19.9 13.6 13.6 0 0110.1 13zm5.5 6a15.7 15.7 0 001.4-6h3a8 8 0 01-4.4 6z" />
);
export const DocIcon = wrap(
  <path d="M6 2h7l5 5v15H6zm7 1.5V8h4.5zM8 12h8v1.6H8zm0 3.2h8v1.6H8z" />
);
export const PlusIcon = wrap(<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />);
export const KeyIcon = wrap(
  <path d="M14 3a6 6 0 00-5.7 8L3 16.3V21h4.7l1.4-1.4V18h1.6l1.4-1.4v-1.7h1.2A6 6 0 1014 3zm2.4 5.2a1.6 1.6 0 110-3.2 1.6 1.6 0 010 3.2z" />
);
