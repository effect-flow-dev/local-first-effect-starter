 
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { Machine, MachineSchema, Service } from "@zag-js/core";
import { VanillaMachine } from "./machine";
import { normalizeProps } from "./normalize-props";

export class ZagController<T extends MachineSchema, TApi>
  implements ReactiveController
{
  private machine: VanillaMachine<T>;
  public api: TApi;

  constructor(
    private host: ReactiveControllerHost,
    machineDef: Machine<T>,
    // Allow either the props object OR a function returning props (supported by VanillaMachine)
    machineProps: Partial<T["props"]> | (() => Partial<T["props"]>),
    private connectFn: (
      service: Service<T>,
      normalize: typeof normalizeProps,
    ) => TApi,
  ) {
    this.machine = new VanillaMachine(machineDef, machineProps);
    // Initial connect
    this.api = this.connectFn(this.machine.service, normalizeProps);
    host.addController(this);
  }

  hostConnected() {
    this.machine.start();
    // Subscribe to state changes to trigger Lit updates
    this.machine.subscribe(() => {
      // Re-connect to get the latest API state
      this.api = this.connectFn(this.machine.service, normalizeProps);
      this.host.requestUpdate();
    });
  }

  hostDisconnected() {
    this.machine.stop();
  }
}
