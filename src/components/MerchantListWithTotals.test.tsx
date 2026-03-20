import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MerchantListWithTotals from "./MerchantListWithTotals";

describe("MerchantListWithTotals", () => {
  it("opens drilldown only via explicit Details button (row not clickable)", () => {
    const onOpenDrilldown = vi.fn();
    render(
      <MerchantListWithTotals
        titel="Händlerliste mit Umsatz"
        list={[{ haendlernummer: "1", name: "Test Händler", sort: null }]}
        umsatz={{ "1": { summe: 12.34, anzahl: 3 } }}
        loading={false}
        emptyText="leer"
        onOpenDrilldown={onOpenDrilldown}
      />
    );

    fireEvent.click(screen.getByText("Test Händler"));
    expect(onOpenDrilldown).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Details/i }));
    expect(onOpenDrilldown).toHaveBeenCalledTimes(1);
    expect(onOpenDrilldown).toHaveBeenCalledWith("1", "Test Händler");
  });
});

