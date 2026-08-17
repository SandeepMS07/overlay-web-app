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

export const PlayIcon = wrap(<path d="M8 5v14l11-7z" />);
export const PauseIcon = wrap(<path d="M6 5h4v14H6zm8 0h4v14h-4z" />);
export const ListIcon = wrap(<path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />);
export const PinIcon = wrap(<path d="M5 4h14v2H5zm7 3l5 5h-3v7h-4v-7H7z" />);
export const GhostIcon = wrap(
  <path d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7zm0 3a4 4 0 100 8 4 4 0 000-8z" />
);
export const MinusIcon = wrap(<path d="M5 11h14v2H5z" />);
export const CloseIcon = wrap(
  <path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z" />
);
export const PlusIcon = wrap(<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />);
export const TrashIcon = wrap(<path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z" />);
export const ExternalIcon = wrap(
  <path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14zM5 5h5v2H7v10h10v-3h2v5H5z" />
);
