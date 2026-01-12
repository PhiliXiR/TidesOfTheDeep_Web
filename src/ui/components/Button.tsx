"use client";

import React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

type Props = Omit<HTMLMotionProps<"button">, "ref"> & {
  variant?: "soft" | "hot";
};

export function Button({ variant = "soft", className = "", ...props }: Props) {
  const cls = ["btn", variant === "hot" ? "btn--hot" : "btn--soft", className]
    .filter(Boolean)
    .join(" ");

  return (
    <motion.button
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.99 }}
      className={cls}
      {...props}
    />
  );
}

export default Button;
