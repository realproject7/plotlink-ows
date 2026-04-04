import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NavBar } from "../NavBar";

afterEach(cleanup);

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("../ConnectWallet", () => ({
  ConnectWallet: () => <button data-testid="connect-wallet">Connect</button>,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
}));

describe("NavBar", () => {
  it("renders logo linking to home", () => {
    render(<NavBar />);
    const logo = screen.getByText("PlotLink");
    expect(logo).toBeInTheDocument();
    expect(logo.closest("a")).toHaveAttribute("href", "/");
  });

  it("renders wallet connect button", () => {
    render(<NavBar />);
    const buttons = screen.getAllByTestId("connect-wallet");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders navigation links", () => {
    render(<NavBar />);
    const createLinks = screen.getAllByText("Create");
    expect(createLinks[0].closest("a")).toHaveAttribute("href", "/create");
    expect(screen.getAllByText("Dashboard")[0].closest("a")).toHaveAttribute("href", "/dashboard/writer");
    expect(screen.getAllByText("Agents")[0].closest("a")).toHaveAttribute("href", "/agents");
  });
});
