import { DestinyVendorsResponse, DestinyVendorGroup } from 'bungie-api-ts/destiny2';
import * as React from 'react';
import { DestinyAccount } from '../accounts/destiny-account.service';
import { getVendors as getVendorsApi } from '../bungie-api/destiny2-api';
import { D2ManifestDefinitions, getDefinitions } from '../destiny2/d2-definitions.service';
import { D2ManifestService } from '../manifest/manifest-service-json';
import { loadingTracker } from '../shell/loading-tracker';
import './vendor.scss';
import { fetchRatingsForVendors } from './vendor-ratings';
import { DimStore } from '../inventory/store-types';
import Vendor from './Vendor';
import ErrorBoundary from '../dim-ui/ErrorBoundary';
import { D2StoresService } from '../inventory/d2-stores.service';
import { UIViewInjectedProps } from '@uirouter/react';
import { Loading } from '../dim-ui/Loading';
import { t } from 'i18next';
import { Subscriptions } from '../rx-utils';
import { refresh$ } from '../shell/refresh';
import { InventoryBuckets } from '../inventory/inventory-buckets';
import CharacterSelect from '../character-select/CharacterSelect';
import { sortStores } from '../shell/dimAngularFilters.filter';
import { RootState } from '../store/reducers';
import { storesSelector, ownedItemsSelector } from '../inventory/reducer';
import { DispatchProp, connect } from 'react-redux';

interface ProvidedProps {
  account: DestinyAccount;
}
interface StoreProps {
  stores: DimStore[];
  buckets?: InventoryBuckets;
  ownedItemHashes: Set<number>;
}

function mapStateToProps(state: RootState): StoreProps {
  return {
    stores: storesSelector(state),
    ownedItemHashes: ownedItemsSelector(state),
    buckets: state.inventory.buckets
  };
}

interface State {
  defs?: D2ManifestDefinitions;
  vendorsResponse?: DestinyVendorsResponse;
  selectedStore?: DimStore;
  error?: Error;
}

type Props = ProvidedProps & StoreProps & UIViewInjectedProps & DispatchProp<any>;

/**
 * The "All Vendors" page for D2 that shows all the rotating vendors.
 */
class Vendors extends React.Component<Props, State> {
  private subscriptions = new Subscriptions();

  constructor(props: Props) {
    super(props);
    this.state = {};
  }

  async loadVendors(selectedStore: DimStore | undefined = this.state.selectedStore) {
    if (this.state.error) {
      this.setState({ error: undefined });
    }

    const defs = await getDefinitions();
    D2ManifestService.loaded = true;

    let characterId: string = this.state.selectedStore
      ? this.state.selectedStore.id
      : this.props.transition!.params().characterId;
    if (!characterId) {
      const stores = this.props.stores;
      if (stores) {
        characterId = stores.find((s) => s.current)!.id;
        selectedStore = stores.find((s) => s.id === characterId);
      }
    }

    if (!characterId) {
      this.setState({ error: new Error("Couldn't load any characters.") });
      return;
    }

    let vendorsResponse;
    try {
      vendorsResponse = await getVendorsApi(this.props.account, characterId);
      this.setState({ defs, vendorsResponse, selectedStore });
    } catch (error) {
      this.setState({ error });
    }

    if (vendorsResponse) {
      this.props.dispatch(fetchRatingsForVendors(defs, vendorsResponse));
    }
  }

  componentDidMount() {
    if (this.props.buckets) {
      const promise = this.loadVendors();
      loadingTracker.addPromise(promise);
    }

    D2StoresService.getStoresStream(this.props.account);

    this.subscriptions.add(
      refresh$.subscribe(() => {
        const promise = this.loadVendors();
        loadingTracker.addPromise(promise);
      })
    );
  }

  componentDidUpdate(prevProps: Props) {
    if (!prevProps.buckets && this.props.buckets) {
      loadingTracker.addPromise(this.loadVendors());
    }
  }

  componentWillUnmount() {
    this.subscriptions.unsubscribe();
  }

  render() {
    const { defs, vendorsResponse, error, selectedStore } = this.state;
    const { account, buckets, stores, ownedItemHashes } = this.props;

    if (error) {
      return (
        <div className="vendor dim-page">
          <div className="dim-error">
            <h2>{t('ErrorBoundary.Title')}</h2>
            <div>{error.message}</div>
          </div>
        </div>
      );
    }

    if (!vendorsResponse || !defs || !buckets || !stores) {
      return (
        <div className="vendor dim-page">
          <Loading />
        </div>
      );
    }

    return (
      <div className="vendor d2-vendors dim-page">
        {selectedStore && (
          <CharacterSelect
            stores={sortStores(stores)}
            selectedStore={selectedStore}
            onCharacterChanged={this.onCharacterChanged}
          />
        )}
        {Object.values(vendorsResponse.vendorGroups.data.groups).map((group) => (
          <VendorGroup
            key={group.vendorGroupHash}
            defs={defs}
            buckets={buckets}
            group={group}
            vendorsResponse={vendorsResponse}
            ownedItemHashes={ownedItemHashes}
            account={account}
          />
        ))}
      </div>
    );
  }

  private onCharacterChanged = (storeId: string) => {
    const selectedStore = this.props.stores.find((s) => s.id === storeId);
    this.setState({ selectedStore });
    this.loadVendors(selectedStore);
  };
}

function VendorGroup({
  defs,
  buckets,
  group,
  vendorsResponse,
  ownedItemHashes,
  account
}: {
  defs: D2ManifestDefinitions;
  buckets: InventoryBuckets;
  group: DestinyVendorGroup;
  vendorsResponse: DestinyVendorsResponse;
  ownedItemHashes?: Set<number>;
  account: DestinyAccount;
}) {
  const groupDef = defs.VendorGroup.get(group.vendorGroupHash);

  return (
    <>
      <h2>{groupDef.categoryName}</h2>
      {group.vendorHashes
        .map((h) => vendorsResponse.vendors.data[h])
        .map((vendor) => (
          <ErrorBoundary key={vendor.vendorHash} name="Vendor">
            <Vendor
              account={account}
              defs={defs}
              buckets={buckets}
              vendor={vendor}
              itemComponents={vendorsResponse.itemComponents[vendor.vendorHash]}
              sales={
                vendorsResponse.sales.data[vendor.vendorHash] &&
                vendorsResponse.sales.data[vendor.vendorHash].saleItems
              }
              ownedItemHashes={ownedItemHashes}
              currencyLookups={vendorsResponse.currencyLookups.data.itemQuantities}
            />
          </ErrorBoundary>
        ))}
    </>
  );
}

export default connect<StoreProps>(mapStateToProps)(Vendors);
