import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormattedAssistantContent } from "@/components/FormattedAssistantContent";

function listStarts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("ol")).map((ol) => ol.getAttribute("start") ?? "1");
}

describe("FormattedAssistantContent", () => {
  it("continues numbering across blank lines", () => {
    const { container } = render(
      <FormattedAssistantContent text={"1. Focus\n\n2. Day 1\n\n3. Day 2"} />,
    );

    expect(listStarts(container)).toEqual(["1", "2", "3"]);
    expect(screen.getByText("Focus")).toBeInTheDocument();
    expect(screen.getByText("Day 1")).toBeInTheDocument();
    expect(screen.getByText("Day 2")).toBeInTheDocument();
  });

  it("renumbers restarted 1. lines into one sequence", () => {
    const { container } = render(
      <FormattedAssistantContent text={"1. Focus\n\n1. Day 1\n• Review the rubric\n\n1. Day 2"} />,
    );

    expect(listStarts(container)).toEqual(["1", "2", "3"]);
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(screen.getByText("Review the rubric")).toBeInTheDocument();
  });
});
