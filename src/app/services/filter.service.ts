import {Injectable, EventEmitter} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {UtilService} from './util.service';
import {StorageService} from './storage.service';
import {DataService} from './data.service';
import {I18nService} from './i18n.service';
import {NamespaceService} from './namespace.service';
import {BroadcastService} from './broadcast.service';
import {DashboardService} from './dashboard.service';
import {IWidgetEvent} from '../components/widgets/base-widget.class';

@Injectable({
    providedIn: 'root'
})
export class FilterService {
    private dashboard = '';
    filtersChanged = false;
    isFiltersOnToolbarExists = false;
    items = [];

    onApplyFilter = new EventEmitter<any>();

    constructor(private route: ActivatedRoute,
                private us: UtilService,
                private ss: StorageService,
                private ds: DataService,
                private ns: NamespaceService,
                private bs: BroadcastService,
                private dbs: DashboardService,
                private i18n: I18nService) {
    }

    /**
     * Initialize service with filter array
     * @param {Array} filterArray Filter array
     */
    init(filterArray, dashboard) {
        this.filtersChanged = true;
        this.dashboard = dashboard;
        this.items = [];
        this.isFiltersOnToolbarExists = false;
        for (let i = 0; i < filterArray.length; i++) {
            this.items.push(filterArray[i]);
            const flt = this.items[this.items.length - 1];

            // Check for valueList
            if (flt.valueList && flt.displayList) {
                const vals = flt.valueList.split(',');
                const txt = flt.displayList.split(',');
                flt.values = [];
                for (let j = 0; i < vals.length; j++) {
                    flt.values.push({name: txt[j], path: vals[j]});
                }
            }

            flt.targetArray = [];
            if ((flt.target !== '*') && (flt.target !== '')) {
                flt.targetArray = flt.target.split(',').concat(['emptyWidget']);
            }
            flt.sourceArray = [];
            if ((flt.source !== '*') && (flt.source !== '') && (flt.location !== 'dashboard')) {
                flt.sourceArray = flt.source.split(',');
            }
            if (flt.source === '' || flt.location === 'dashboard') {
                this.isFiltersOnToolbarExists = true;
            }

            // Parse additional filter parameters placed in filter label as comment
            if (flt.label) {
                // Find commented part as /* text */
                const parts = flt.label.match(/(\/\*([^*]|[\r\n]|(\*+([^*\/]|[\r\n])))*\*+\/)|(\/\/.*)/g);
                if (parts && parts.length !== 0) {
                    const params = parts[0].substring(2, parts[0].length - 2);
                    flt.additionalParams = params.toLowerCase().trim().split(',');

                    if (flt.additionalParams.indexOf('inverseorder') !== -1) {
                        flt.values = flt.values.reverse();
                    }
                    if (flt.additionalParams.indexOf('ignorenow') !== -1) {
                        flt.values = flt.values.filter((v) => v.path.toLowerCase() !== '&[now]');
                    }
                }
                flt.label = flt.label.replace(/(\/\*([^*]|[\r\n]|(\*+([^*\/]|[\r\n])))*\*+\/)|(\/\/.*)/g, '');
            }

            flt.valueDisplay = this.findDisplayText(flt);
        }

        this.loadFiltersFromSettings();
        this.loadFiltersFromUrl();
    }

    // Removes parameter from url
    private removeParameterFromUrl(url, parameter) {
        return url
            .replace(new RegExp('[?&]' + parameter + '=[^&#]*(#.*)?$'), '$1')
            .replace(new RegExp('([?&])' + parameter + '=[^&]*&'), '$1');
    }

    /**
     * Returns whole share ulr for filters on dashboard
     */
    public getFiltersShareUrl() {
        let url = window.location.href;
        url = this.removeParameterFromUrl(url, 'FILTERS');
        const part = url.split('#')[1];
        const fltUrl = this.getFiltersUrlString();
        const flt = 'FILTERS=TARGET:*;FILTER:' + fltUrl;
        if (fltUrl) {
            if (part && part.indexOf('?') !== -1) {
                url += '&' + flt;
            } else {
                url += '?' + flt;
            }
        }
        return url;
    }

    /**
     * Return parameters for ulr with filters for widget or for all dashboard
     * @param {string} [widgetName] Name of widget
     * @returns {string}
     */
    getFiltersUrlString(widgetName?: string, ignoreTargetAll = false) {
        const f = [];
        let widgetFilters = widgetName ? this.getAffectsFilters(widgetName) : this.items;
        if (ignoreTargetAll && widgetFilters) {
            widgetFilters  = widgetFilters.filter(f => f.target !== '*');
        }
        for (let i = 0; i < widgetFilters.length; i++) {
            const flt = widgetFilters[i];
            if (!flt.value && !flt.isInterval) {
                continue;
            }
            let v = '';
            if (flt.isInterval) {
                // Format filter string like path.v1:v2
                v = flt.targetProperty + '.' + flt.values[flt.fromIdx].path + ':' + flt.values[flt.toIdx].path;
            } else {
                v = flt.targetProperty + '.' + (flt.isExclude ? '%NOT ' : '') + flt.value;
            }
            // For many selected values make correct filter string {v1,v2,v3}
            if (v.indexOf('|') !== -1) {
                v = v.replace(/\|/g, ',').replace('&[', '{&[') + '}';
            }
            f.push(v);
        }
        return encodeURIComponent(f.join('~'));
    }


    loadFiltersFromUrl() {
        const param = this.route.snapshot.queryParamMap.get('FILTERS');
        if (!param) {
            return;
        }
        const params = param.split(';');
        let widgetName = null;
        let filters = '';
        for (let i = 0; i < params.length; i++) {
            const parts = params[i].split(':');
            if (parts[0].toLowerCase() === 'target') {
                widgetName = parts[1];
                continue;
            }
            if (parts[0].toLowerCase() === 'filter') {
                filters = parts.slice(1).join(':');
            }
        }
        // Get affected filters
        let flt = [];
        if (widgetName !== '*') {
            flt = this.items.filter(f => f.targetArray.indexOf(widgetName) !== -1 || f.target === widgetName || f.target === '*');
        } else {
            flt = this.items.slice();
        }
        flt.forEach(f => {
            const urlFilters = filters.split('~');
            for (let i = 0; i < urlFilters.length; i++) {
                const s = decodeURIComponent(urlFilters[i]);
                // Check filter path
                if (s.indexOf('{') !== -1) {
                    // Many values
                    const path = s.substring(0, s.indexOf('{') - 1).replace('%NOT ', '');
                    if (path !== f.targetProperty) {
                        continue;
                    }
                    // &[30 to 59]|&[60+]|"
                    const values = s.match(/\{([^)]+)\}/)[1].split(',');
                    f.value = values.join('|');
                    f.valueDisplay = values.map(v => v.replace('&[', '').replace(']', '')).join(',');
                } else {
                    // One value
                    const path = s.split('.&')[0];
                    if (path !== f.targetProperty) {
                        continue;
                    }
                    f.value = '&' + s.split('.&')[1];
                    f.valueDisplay = this.findDisplayText(f);
                }
            }
        });
    }

    /**
     * Load saved filter values from settings
     */
    private loadFiltersFromSettings() {
        // Don't Load filters for shared widget
        if (this.us.isEmbedded()) {
            return;
        }

        if (!this.ss.getAppSettings()?.isSaveFilters) {
            return;
        }
        let found = false;

        const widgets = this.ss.getWidgetsSettings(this.dashboard);
        if (widgets._filters) {
            for (let i = 0; i < widgets._filters.length; i++) {
                const flt = widgets._filters[i];

                const exists = this.items.filter((el) => {
                        return el.targetProperty === flt.targetProperty;
                    })[0];
                if (exists) {
                    // Check for single value
                    exists.value = flt.value;
                    exists.isExclude = flt.isExclude;
                    exists.isInterval = flt.isInterval;

                    if (exists.isInterval) {
                        exists.fromIdx = flt.fromIdx;
                        exists.toIdx = flt.toIdx;
                        exists.valueDisplay = exists.values[exists.fromIdx].name + ':' + exists.values[exists.toIdx].name;
                    } else {
                        const values = flt.value.split('|');

                        // Multiple values was selected
                        exists.values.forEach((v) => {
                            if (values.indexOf(v.path) !== -1) {
                                v.checked = true;
                            }
                        });

                        exists.valueDisplay = flt.value.split('|').map(el => {
                            const isNot = el.indexOf('.%NOT') !== -1;
                            if (isNot) {
                                el = el.replace('.%NOT', '');
                            }
                            const v = exists.values.find(e => e.path == el);
                            let name = '';
                            if (v && v.name) {
                                name = v.name.toString();
                            }
                            return (isNot ? this.i18n.get('not') + ' ' : '') + name;
                        }).join(',');
                    }

                    found = true;
                }
            }
        }
    }

    getClickFilterTarget(widgetName: string) {
        for (let i = 0; i < this.items.length; i++) {
            const flt = this.items[i];
            if (flt.location !== 'click') {
                continue;
            }
            if (flt.source.toLowerCase() === widgetName.toLowerCase() || flt.source === '*') {
                return flt.target;
            }
        }
    }

    /**
     * Return all filters that affects on widget
     * @param {string} widgetName Widget name
     * @returns {Array.<object>} Filter list
     */
    getAffectsFilters(widgetName: string) {
        return this.items.filter(e => (e.target === '*' || e.target === widgetName || e.targetArray.indexOf(widgetName) !== -1));
    }

    /**
     * Returns filter display text
     * @param {object} flt Filter
     * @returns {string} Filter display text
     */
    findDisplayText(flt) {
        if (flt.value === '' || flt.value === undefined) {
            return '';
        }
        let value = flt.value;
        let isExclude = false;
        if (typeof value === 'string') {
            isExclude = value.toUpperCase().endsWith('.%NOT');
        }
        if (isExclude) {
            value = value.substr(0, value.length - 5);
        }
        flt.value = value;
        for (let i = 0; i < flt.values.length; i++) {
            if (flt.values[i].path === value) {
                flt.values[i].checked = true;
                flt.values[i].default = true;
                flt.defaultExclude = isExclude;
                flt.isExclude = isExclude;
                return flt.values[i].name;
            }
        }
        return '';
    }

    /**
     * Returns model representation of filters, not filters itself. To get filter use Filters.getFilter(flt.idx)
     * @param {string} widgetName Returns filters of widget with this name
     * @returns {Array} Model filters
     */
    getWidgetModelFilters(widgetName) {
        const res = [];
        for (let i = 0; i < this.items.length; i++) {
            if (this.items[i].type === 'hidden') {
                continue;
            }
            if (this.items[i].location === 'click') {
                continue;
            }
            if (widgetName === 'emptyWidget') {
                if (this.items[i].source === '' || this.items[i].location === 'dashboard') {
                    res.push({idx: i, label: this.items[i].label, text: this.items[i].valueDisplay, info: this.items[i].info});
                    continue;
                }
            }
            if (this.items[i].location === 'dashboard') {
                continue;
            }
            if ((this.items[i].source === '*') || (this.items[i].sourceArray.indexOf(widgetName) !== -1)) {
                res.push({idx: i, label: this.items[i].label, text: this.items[i].valueDisplay, info: this.items[i].info});
                continue;
            }
        }
        return res;
    }

    /**
     * Returns list of filters USED by widget (note: this filters can be displayed on another widgets, to get displayed filters use getWidgetModelFilters)
     * @param {string} widgetName Widget name
     * @returns {Array} Filters used by widget
     */
    getWidgetFilters(widgetName) {
        const res = [];
        for (let i = 0; i < this.items.length; i++) {
            if ((this.items[i].target === '*' || this.items[i].target === '') || (this.items[i].targetArray.indexOf(widgetName) !== -1)) {
                res.push(this.items[i]);
            }
        }
        return res;
    }

    /**
     * Applies filter
     * @param {object} flt Filter to apply
     * @param {boolean} noRefresh Disable refresh broadcast if true
     */
    applyFilter(flt, noRefresh?) {
        this.onApplyFilter.emit(flt);
        let disp = '';
        let val = '';
        let i;
        for (i = 0; i < flt.values.length; i++) {
            if (flt.values[i].checked) {
                disp += flt.values[i].name + ',';
                val += flt.values[i].path + '|';
            }
        }
        if (disp !== '') {
            disp = disp.substr(0, disp.length - 1);
        }
        if (val !== '') {
            val = val.substr(0, val.length - 1);
        }
        flt.valueDisplay = disp;
        flt.value = val;
        if (!noRefresh) {
            if (flt.targetArray.length !== 0) {
                // Listened in widget.component.ts
                for (i = 0; i < flt.targetArray.length; i++) {
                    this.bs.broadcast('filter' + flt.targetArray[i], flt);
                }
            } else {
                // Listened in widget.component.ts
                if (flt.target === '*' || flt.target === '') {
                    this.bs.broadcast('filterAll', flt);
                }
            }

            if (flt.sourceArray.length !== 0) {
                // Listened in widget.component.ts
                for (i = 0; i < flt.sourceArray.length; i++) {
                    this.bs.broadcast('updateFilterText' + flt.sourceArray[i], flt);
                }
            }
        }
        this.filtersChanged = true;
        this.saveFilters();
        this.updateFiltersParameterInURL();
    }

    private updateFiltersParameterInURL() {
        if (!this.us.isEmbedded()) {
            return;
        }
        const idx = this.route.snapshot.queryParamMap.get('widget');
        const widget = this.dbs.getAllWidgets()[parseInt(idx, 10)];
        const name = widget?.name;
        const filters = 'TARGET:*;FILTER:' + this.getFiltersUrlString(name, true);
        this.ds.router.navigate(
            [],
            {
                relativeTo: this.route,
                queryParams: { FILTERS: filters},
                queryParamsHandling: 'merge'
            });

        const event = {
            type: 'filter',
            index: this.route.snapshot.queryParamMap.get('widget'),
            widget,
            filters
        } as IWidgetEvent;

        if (window.parent) {
            window.parent.postMessage(event, '*');
        }
        try {
            if ((window.parent as any).dsw?.onFilter) {
                (window.parent as any).dsw.onFilter(event);
            }
        }
        catch (e) {
            console.error(e);
        }
    }

    /**
     * Saves dashboard filters
     */
    saveFilters() {
        const settings = this.ss.getAppSettings();
        if (settings.isSaveFilters === false) {
            return;
        }

        let i;
        let flt;
        const active = [];
        for (i = 0; i < this.items.length; i++) {
            flt = this.items[i];
            if (flt.value !== '' || flt.isInterval) {
                active.push(flt);
            }
        }
        const res = active.map(e => {
            return {
                targetProperty: e.targetProperty,
                value: e.value,
                isExclude: e.isExclude,
                isInterval: e.isInterval,
                fromIdx: e.fromIdx,
                toIdx: e.toIdx
            };
        });

        const widgets = this.ss.getWidgetsSettings(this.dashboard);
        if (res.length) {
            widgets._filters = res;
        } else {
            delete widgets._filters;
        }
        this.ss.setWidgetsSettings(widgets, this.dashboard);
    }

    /**
     * Returns filter by index
     * @param {number} idx Filter index
     * @returns {object} Filter
     */
    getFilter(idx) {
        if (!this.items[idx]) {
            return undefined;
        }
        return this.items[idx];
    }

    /**
     * Clear all filters
     */
    clear() {
        this.items = [];
    }
}
