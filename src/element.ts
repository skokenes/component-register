import { connectedToDOM, propValues, isConstructor, toComponentName, initializeProps, parseAttributeValue, ComponentType, ConstructableComponent, FunctionComponent, PropsDefinition } from './utils';

export interface ICustomElement {
  [prop: string]: any;
  __initializing: boolean;
  __initialized: boolean;
  __released: boolean;
  __releaseCallbacks: any[];
  __propertyChangedCallbacks: any[];
  __updating: { [prop: string]: any };
  props: { [prop: string]: any };
  reloadComponent(): void;
  lookupProp(attrName: string): string | undefined;
  renderRoot(): Node;
  setProperty(name: string, value: unknown): void;
  trigger(name: string, options: { detail?: any, bubbles?: boolean, cancelable?: boolean, composed?: boolean }): CustomEvent;
  addReleaseCallback(fn: () => void): void;
  addPropertyChangedCallback(fn: (name: string, value: any) => void): void;
}

let currentElement: HTMLElement;
export function getCurrentElement() { return currentElement; }

export function createElementType(BaseElement: typeof HTMLElement, propDefinition: PropsDefinition) {
  const propKeys = Object.keys(propDefinition);
  return class CustomElement extends BaseElement implements ICustomElement {
    [prop: string]: any;
    __initializing: boolean;
    __initialized: boolean;
    __released: boolean;
    __releaseCallbacks: any[];
    __propertyChangedCallbacks: any[];
    __updating: { [prop: string]: any };
    props: { [prop: string]: any };

    static get observedAttributes() { return propKeys.map(k => propDefinition[k].attribute); }

    constructor() {
      super();
      this.__initializing = false;
      this.__initialized = false;
      this.__released = false;
      this.__releaseCallbacks = [];
      this.__propertyChangedCallbacks = [];
      this.__updating = {};
      this.props = {};
    }

    connectedCallback() {
      // check that infact it connected since polyfill sometimes double calls
      if (!connectedToDOM(this) || this.__initializing || this.__initialized) return;
      this.__releaseCallbacks = [];
      this.__propertyChangedCallbacks = [];
      this.__updating = {};
      this.props = initializeProps(this, propDefinition);
      const props = propValues(this.props),
        ComponentType = this.Component as Function | {new(...args: any[]): any},
        outerElement = currentElement;
      try {
        this.__initializing = true;
        currentElement = this;
        if (isConstructor(ComponentType)) new (ComponentType as ConstructableComponent)(props, {element: this});
        else (ComponentType as FunctionComponent)(props, {element: this});
      } catch (err) {
        console.error(`Error creating component ${toComponentName(this.nodeName.toLowerCase())}:`, err);
      } finally {
        currentElement = outerElement;
        delete this.__initializing;
      }
      this.__initialized = true;
    }

    disconnectedCallback() {
      // prevent premature releasing when element is only temporarely removed from DOM
      Promise.resolve().then(() => {
        if (connectedToDOM(this)) return;
        this.__propertyChangedCallbacks.length = 0;
        let callback = null;
        while (callback = this.__releaseCallbacks.pop()) callback(this);
        delete this.__initialized;
        this.__released = true;
      });
    }

    attributeChangedCallback(name: string, oldVal: string, newVal: string) {
      if (!this.__initialized) return;
      if (this.__updating[name]) return;
      name = this.lookupProp(name) as string;
      if (name in propDefinition) {
        if (newVal == null && !this[name]) return;
        this[name] = parseAttributeValue(newVal);
      }
    }

    reloadComponent() {
      let callback = null;
      while(callback = this.__releaseCallbacks.pop()) callback(this);
      delete this.__initialized;
      this.renderRoot().textContent = '';
      this.connectedCallback();
    }

    lookupProp(attrName: string) {
      if(!propDefinition) return;
      return propKeys.find(k => attrName === k || attrName === propDefinition[k].attribute);
    }

    renderRoot() { return this.shadowRoot || this.attachShadow({ mode: 'open' }); }

    setProperty(name: string, value: unknown) {
      if (!(name in this.props)) return;
      const prop = this.props[name],
        oldValue = prop.value;
      this[name] = value;
      if (prop.notify)
        this.trigger('propertychange', {detail: {value, oldValue, name}})
    }

    trigger(
      name:string,
      {detail, bubbles = true, cancelable = true, composed = true}
      : {detail?: any, bubbles?: boolean, cancelable?: boolean, composed?: boolean} = {}
    ) {
      const event = new CustomEvent(name, {detail, bubbles, cancelable, composed});
      let cancelled = false;
      if (this['on'+name]) cancelled = this['on'+name](event) === false;
      if (cancelled) event.preventDefault();
      this.dispatchEvent(event);
      return event;
    }

    addReleaseCallback(fn: () => void) { this.__releaseCallbacks.push(fn) }

    addPropertyChangedCallback(fn: (name: string, value: any) => void) { this.__propertyChangedCallbacks.push(fn); }
  }
}