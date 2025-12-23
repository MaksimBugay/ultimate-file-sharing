/**
 * Secure FileShare DateTime Picker
 * Production-grade datetime picker component (24H format)
 * Author: FileShare Team
 * Version: 1.1.0
 * 
 * Usage:
 *   const picker = new SFSPDateTimePicker({
 *     container: document.getElementById('my-container'),
 *     label: 'Select Date & Time',
 *     onChange: (timestamp) => console.log('Unix timestamp:', timestamp)
 *   });
 */

(function(global) {
  'use strict';

  // Constants
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const MONTHS_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const VIEW = {
    DAYS: 'days',
    MONTHS: 'months',
    YEARS: 'years'
  };

  /**
   * Main DateTimePicker Class
   */
  class SFSPDateTimePicker {
    /**
     * Create a new datetime picker instance
     * @param {Object} options - Configuration options
     * @param {HTMLElement} options.container - Container element to render the picker into
     * @param {string} [options.label='Select Date & Time'] - Label text displayed to the left of input
     * @param {Function} [options.onChange] - Callback when datetime changes, receives Unix timestamp
     * @param {Function} [options.getInitialDate] - Function that returns initial Date. Receives current Date as parameter. Defaults to current time.
     * @param {Date} [options.minDate] - Minimum selectable date
     * @param {Date} [options.maxDate] - Maximum selectable date
     * @param {string} [options.placeholder='Click to select date and time']
     * @param {boolean} [options.showTime=true] - Whether to show time picker
     * @param {string} [options.theme='light'] - Theme: 'light', 'dark', or 'auto'
     * @param {string} [options.inputMaxWidth='220px'] - Maximum width of the input element
     */
    constructor(options = {}) {
      this.options = {
        container: null,
        label: 'Select Date & Time',
        onChange: null,
        getInitialDate: null,
        minDate: null,
        maxDate: null,
        placeholder: 'Click to select date and time',
        showTime: true,
        theme: 'light',
        inputMaxWidth: '220px',
        ...options
      };

      if (!this.options.container) {
        throw new Error('SFSPDateTimePicker: container option is required');
      }

      // State
      this.isOpen = false;
      this.currentView = VIEW.DAYS;
      this.viewDate = new Date();
      this.selectedDate = null;
      this.selectedHours = 0;
      this.selectedMinutes = 0;

      // Initialize with initial timestamp or current time
      this._initializeDateTime();

      // DOM references
      this.elements = {};

      // Bind methods
      this._onDocumentClick = this._onDocumentClick.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);

      // Initialize
      this._render();
      this._attachEventListeners();
    }

    /**
     * Initialize date and time from getInitialDate function or current time
     */
    _initializeDateTime() {
      const now = new Date();
      let date;
      
      if (typeof this.options.getInitialDate === 'function') {
        // Call the function with current date
        date = this.options.getInitialDate(now);
        if (!(date instanceof Date)) {
          date = now;
        }
      } else {
        // Default to current time
        date = now;
      }

      this.selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      this.viewDate = new Date(this.selectedDate);
      this.selectedHours = date.getHours();
      this.selectedMinutes = date.getMinutes();
    }

    /**
     * Render the picker HTML
     */
    _render() {
      const container = this.options.container;
      container.innerHTML = '';

      // Create main wrapper
      const wrapper = document.createElement('div');
      wrapper.className = 'sfsp-datetime-picker';
      wrapper.setAttribute('data-theme', this.options.theme);

      const inputMaxWidth = this.options.inputMaxWidth;

      wrapper.innerHTML = `
        <div class="sfsp-inline-container">
          <label class="sfsp-label">${this._escapeHtml(this.options.label)}</label>
          <div class="sfsp-input-wrapper" style="max-width: ${inputMaxWidth}">
            <input 
              type="text" 
              class="sfsp-input" 
              placeholder="${this._escapeHtml(this.options.placeholder)}"
              readonly
              aria-label="${this._escapeHtml(this.options.label)}"
              aria-haspopup="dialog"
              aria-expanded="false"
            >
            <button type="button" class="sfsp-toggle-btn" aria-label="Open calendar">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="sfsp-dropdown" role="dialog" aria-modal="true" aria-label="Date and time picker">
          ${this._renderDropdownContent()}
        </div>
      `;

      container.appendChild(wrapper);

      // Cache DOM references
      this.elements = {
        wrapper,
        input: wrapper.querySelector('.sfsp-input'),
        toggleBtn: wrapper.querySelector('.sfsp-toggle-btn'),
        dropdown: wrapper.querySelector('.sfsp-dropdown'),
        header: wrapper.querySelector('.sfsp-header'),
        prevBtn: wrapper.querySelector('.sfsp-nav-prev'),
        nextBtn: wrapper.querySelector('.sfsp-nav-next'),
        monthYear: wrapper.querySelector('.sfsp-month-year'),
        daysContainer: wrapper.querySelector('.sfsp-days'),
        hoursInput: wrapper.querySelector('.sfsp-hours'),
        minutesInput: wrapper.querySelector('.sfsp-minutes')
      };

      // Update display
      this._updateInputValue();
    }

    /**
     * Render dropdown content based on current view
     */
    _renderDropdownContent() {
      let content = `
        <div class="sfsp-header">
          <button type="button" class="sfsp-nav-btn sfsp-nav-prev" aria-label="Previous">‹</button>
          <span class="sfsp-month-year" role="button" tabindex="0" aria-label="Click to select month and year">
            ${this._getHeaderText()}
          </span>
          <button type="button" class="sfsp-nav-btn sfsp-nav-next" aria-label="Next">›</button>
        </div>
      `;

      if (this.currentView === VIEW.DAYS) {
        content += this._renderDaysView();
      } else if (this.currentView === VIEW.MONTHS) {
        content += this._renderMonthsView();
      } else if (this.currentView === VIEW.YEARS) {
        content += this._renderYearsView();
      }

      if (this.options.showTime && this.currentView === VIEW.DAYS) {
        content += this._renderTimeSection();
      }

      content += this._renderFooter();

      return content;
    }

    /**
     * Get header text based on current view
     */
    _getHeaderText() {
      if (this.currentView === VIEW.DAYS) {
        return `${MONTHS[this.viewDate.getMonth()]} ${this.viewDate.getFullYear()}`;
      } else if (this.currentView === VIEW.MONTHS) {
        return `${this.viewDate.getFullYear()}`;
      } else {
        const startYear = Math.floor(this.viewDate.getFullYear() / 12) * 12;
        return `${startYear} - ${startYear + 11}`;
      }
    }

    /**
     * Render days view
     */
    _renderDaysView() {
      let html = '<div class="sfsp-weekdays">';
      WEEKDAYS.forEach(day => {
        html += `<div class="sfsp-weekday">${day}</div>`;
      });
      html += '</div><div class="sfsp-days">';

      const year = this.viewDate.getFullYear();
      const month = this.viewDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startingDay = firstDay.getDay();
      const totalDays = lastDay.getDate();

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Previous month days
      const prevMonth = new Date(year, month, 0);
      const prevDays = prevMonth.getDate();
      for (let i = startingDay - 1; i >= 0; i--) {
        const day = prevDays - i;
        html += `<button type="button" class="sfsp-day sfsp-other-month" data-date="${year}-${month - 1}-${day}">${day}</button>`;
      }

      // Current month days
      for (let day = 1; day <= totalDays; day++) {
        const date = new Date(year, month, day);
        const classes = ['sfsp-day'];
        
        if (date.getTime() === today.getTime()) {
          classes.push('sfsp-today');
        }
        
        if (this.selectedDate && date.getTime() === this.selectedDate.getTime()) {
          classes.push('sfsp-selected');
        }

        if (this._isDateDisabled(date)) {
          classes.push('sfsp-disabled');
        }

        html += `<button type="button" class="${classes.join(' ')}" data-date="${year}-${month}-${day}">${day}</button>`;
      }

      // Next month days
      const remainingCells = 42 - (startingDay + totalDays);
      for (let day = 1; day <= remainingCells; day++) {
        html += `<button type="button" class="sfsp-day sfsp-other-month" data-date="${year}-${month + 1}-${day}">${day}</button>`;
      }

      html += '</div>';
      return html;
    }

    /**
     * Render months view
     */
    _renderMonthsView() {
      let html = '<div class="sfsp-month-grid">';
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      const selectedMonth = this.selectedDate ? this.selectedDate.getMonth() : -1;
      const selectedYear = this.selectedDate ? this.selectedDate.getFullYear() : -1;

      MONTHS_SHORT.forEach((month, index) => {
        const classes = ['sfsp-month-item'];
        
        if (index === currentMonth && this.viewDate.getFullYear() === currentYear) {
          classes.push('sfsp-current');
        }
        
        if (index === selectedMonth && this.viewDate.getFullYear() === selectedYear) {
          classes.push('sfsp-selected');
        }

        html += `<button type="button" class="${classes.join(' ')}" data-month="${index}">${month}</button>`;
      });

      html += '</div>';
      return html;
    }

    /**
     * Render years view
     */
    _renderYearsView() {
      let html = '<div class="sfsp-year-grid">';
      const currentYear = new Date().getFullYear();
      const selectedYear = this.selectedDate ? this.selectedDate.getFullYear() : -1;
      const startYear = Math.floor(this.viewDate.getFullYear() / 12) * 12;

      for (let i = 0; i < 12; i++) {
        const year = startYear + i;
        const classes = ['sfsp-year-item'];
        
        if (year === currentYear) {
          classes.push('sfsp-current');
        }
        
        if (year === selectedYear) {
          classes.push('sfsp-selected');
        }

        html += `<button type="button" class="${classes.join(' ')}" data-year="${year}">${year}</button>`;
      }

      html += '</div>';
      return html;
    }

    /**
     * Render time picker section (24H format only)
     */
    _renderTimeSection() {
      const hours = String(this.selectedHours).padStart(2, '0');
      const minutes = String(this.selectedMinutes).padStart(2, '0');

      return `
        <div class="sfsp-time-section">
          <label class="sfsp-time-label">Time (24H)</label>
          <div class="sfsp-time-inputs">
            <input type="text" class="sfsp-time-input sfsp-hours" value="${hours}" maxlength="2" aria-label="Hours (0-23)">
            <span class="sfsp-time-separator">:</span>
            <input type="text" class="sfsp-time-input sfsp-minutes" value="${minutes}" maxlength="2" aria-label="Minutes (0-59)">
          </div>
        </div>
      `;
    }

    /**
     * Render footer with action buttons
     */
    _renderFooter() {
      return `
        <div class="sfsp-footer">
          <button type="button" class="sfsp-btn sfsp-btn-today">Now</button>
          <button type="button" class="sfsp-btn sfsp-btn-confirm">Confirm</button>
        </div>
      `;
    }

    /**
     * Check if a date is disabled
     */
    _isDateDisabled(date) {
      if (this.options.minDate && date < this.options.minDate) {
        return true;
      }
      if (this.options.maxDate && date > this.options.maxDate) {
        return true;
      }
      return false;
    }

    /**
     * Attach event listeners
     */
    _attachEventListeners() {
      // Toggle button click
      this.elements.toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });
      
      // Input click
      this.elements.input.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });

      // Dropdown events (delegated) - stop propagation to prevent outside click detection
      this.elements.dropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        this._handleDropdownClick(e);
      });
      
      // Time inputs
      this._attachTimeInputListeners();

      // Document events
      document.addEventListener('click', this._onDocumentClick);
      document.addEventListener('keydown', this._onKeyDown);
    }

    /**
     * Attach time input listeners
     */
    _attachTimeInputListeners() {
      const hoursInput = this.elements.dropdown.querySelector('.sfsp-hours');
      const minutesInput = this.elements.dropdown.querySelector('.sfsp-minutes');

      if (hoursInput) {
        hoursInput.addEventListener('input', (e) => this._handleHoursInput(e));
        hoursInput.addEventListener('blur', (e) => this._handleHoursBlur(e));
      }

      if (minutesInput) {
        minutesInput.addEventListener('input', (e) => this._handleMinutesInput(e));
        minutesInput.addEventListener('blur', (e) => this._handleMinutesBlur(e));
      }
    }

    /**
     * Handle dropdown click events
     */
    _handleDropdownClick(e) {
      const target = e.target;

      // Navigation buttons
      if (target.classList.contains('sfsp-nav-prev')) {
        this._navigate(-1);
      } else if (target.classList.contains('sfsp-nav-next')) {
        this._navigate(1);
      }

      // Month/Year header click
      if (target.classList.contains('sfsp-month-year')) {
        this._cycleView();
      }

      // Day selection
      if (target.classList.contains('sfsp-day') && !target.classList.contains('sfsp-disabled')) {
        const [year, month, day] = target.dataset.date.split('-').map(Number);
        this._selectDate(new Date(year, month, day));
      }

      // Month selection
      if (target.classList.contains('sfsp-month-item')) {
        const month = parseInt(target.dataset.month);
        this.viewDate.setMonth(month);
        this.currentView = VIEW.DAYS;
        this._updateDropdown();
      }

      // Year selection
      if (target.classList.contains('sfsp-year-item')) {
        const year = parseInt(target.dataset.year);
        this.viewDate.setFullYear(year);
        this.currentView = VIEW.MONTHS;
        this._updateDropdown();
      }

      // Footer buttons
      if (target.classList.contains('sfsp-btn-today')) {
        this._selectNow();
      } else if (target.classList.contains('sfsp-btn-confirm')) {
        this._confirm();
      }
    }

    /**
     * Handle hours input (24H format: 0-23)
     */
    _handleHoursInput(e) {
      const value = e.target.value.replace(/\D/g, '');
      let hours = parseInt(value) || 0;
      hours = Math.max(0, Math.min(23, hours));
      
      this.selectedHours = hours;
      e.target.value = value;
    }

    /**
     * Handle hours blur (24H format: 0-23)
     */
    _handleHoursBlur(e) {
      let hours = parseInt(e.target.value) || 0;
      hours = Math.max(0, Math.min(23, hours));
      
      this.selectedHours = hours;
      e.target.value = String(hours).padStart(2, '0');
      this._updateInputValue();
      this._triggerChange();
    }

    /**
     * Handle minutes input
     */
    _handleMinutesInput(e) {
      const value = e.target.value.replace(/\D/g, '');
      let minutes = parseInt(value) || 0;
      minutes = Math.max(0, Math.min(59, minutes));
      
      this.selectedMinutes = minutes;
      e.target.value = value;
    }

    /**
     * Handle minutes blur
     */
    _handleMinutesBlur(e) {
      let minutes = parseInt(e.target.value) || 0;
      minutes = Math.max(0, Math.min(59, minutes));
      
      this.selectedMinutes = minutes;
      e.target.value = String(minutes).padStart(2, '0');
      this._updateInputValue();
      this._triggerChange();
    }

    /**
     * Navigate months/years
     */
    _navigate(direction) {
      if (this.currentView === VIEW.DAYS) {
        this.viewDate.setMonth(this.viewDate.getMonth() + direction);
      } else if (this.currentView === VIEW.MONTHS) {
        this.viewDate.setFullYear(this.viewDate.getFullYear() + direction);
      } else {
        this.viewDate.setFullYear(this.viewDate.getFullYear() + (direction * 12));
      }
      this._updateDropdown();
    }

    /**
     * Cycle through views
     */
    _cycleView() {
      if (this.currentView === VIEW.DAYS) {
        this.currentView = VIEW.MONTHS;
      } else if (this.currentView === VIEW.MONTHS) {
        this.currentView = VIEW.YEARS;
      } else {
        this.currentView = VIEW.DAYS;
      }
      this._updateDropdown();
    }

    /**
     * Select a date
     */
    _selectDate(date) {
      this.selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      this.viewDate = new Date(this.selectedDate);
      this._updateDropdown();
      this._updateInputValue();
      this._triggerChange();
    }

    /**
     * Select current date and time
     */
    _selectNow() {
      const now = new Date();
      this.selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      this.viewDate = new Date(this.selectedDate);
      this.selectedHours = now.getHours();
      this.selectedMinutes = now.getMinutes();
      
      this.currentView = VIEW.DAYS;
      this._updateDropdown();
      this._updateInputValue();
      this._triggerChange();
    }

    /**
     * Confirm selection
     */
    _confirm() {
      this._updateInputValue();
      this.close();
      this._triggerChange();
    }

    /**
     * Update dropdown content
     */
    _updateDropdown() {
      this.elements.dropdown.innerHTML = this._renderDropdownContent();
      this._attachTimeInputListeners();
    }

    /**
     * Update input value
     */
    _updateInputValue() {
      if (!this.selectedDate) {
        this.elements.input.value = '';
        return;
      }

      const date = this._formatDate(this.selectedDate);
      let time = '';
      
      if (this.options.showTime) {
        const hours = String(this.selectedHours).padStart(2, '0');
        const minutes = String(this.selectedMinutes).padStart(2, '0');
        time = ` ${hours}:${minutes}`;
      }

      this.elements.input.value = date + time;
    }

    /**
     * Format date for display
     */
    _formatDate(date) {
      const month = MONTHS_SHORT[date.getMonth()];
      const day = date.getDate();
      const year = date.getFullYear();
      return `${month} ${day}, ${year}`;
    }

    /**
     * Trigger onChange callback
     */
    _triggerChange() {
      if (typeof this.options.onChange === 'function') {
        const timestamp = this.getTimestamp();
        this.options.onChange(timestamp, this.getDate());
      }
    }

    /**
     * Handle document click (close on outside click)
     */
    _onDocumentClick(e) {
      if (this.isOpen && !this.elements.wrapper.contains(e.target)) {
        this.close();
      }
    }

    /**
     * Handle keyboard events
     */
    _onKeyDown(e) {
      if (!this.isOpen) return;

      if (e.key === 'Escape') {
        this.close();
      }
    }

    /**
     * Escape HTML special characters
     */
    _escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // ==================== PUBLIC API ====================

    /**
     * Open the picker dropdown
     */
    open() {
      if (this.isOpen) return;
      
      this.isOpen = true;
      this.currentView = VIEW.DAYS;
      this._updateDropdown();
      this.elements.dropdown.classList.add('sfsp-open');
      this.elements.input.setAttribute('aria-expanded', 'true');
    }

    /**
     * Close the picker dropdown
     */
    close() {
      if (!this.isOpen) return;
      
      this.isOpen = false;
      this.elements.dropdown.classList.remove('sfsp-open');
      this.elements.input.setAttribute('aria-expanded', 'false');
    }

    /**
     * Toggle the picker dropdown
     */
    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }

    /**
     * Clear the selection (resets to current time)
     */
    clear() {
      const now = new Date();
      this.selectedDate = null;
      this.selectedHours = now.getHours();
      this.selectedMinutes = now.getMinutes();
      this.viewDate = new Date();
      this._updateDropdown();
      this._updateInputValue();
      this._triggerChange();
    }

    /**
     * Get the selected date as a Date object
     * @returns {Date|null}
     */
    getDate() {
      if (!this.selectedDate) return null;

      const date = new Date(this.selectedDate);
      date.setHours(this.selectedHours, this.selectedMinutes, 0, 0);
      return date;
    }

    /**
     * Get the selected datetime as Unix timestamp (seconds)
     * @returns {number|null}
     */
    getTimestamp() {
      const date = this.getDate();
      return date ? Math.floor(date.getTime() / 1000) : null;
    }

    /**
     * Set the date programmatically
     * @param {Date|number} value - Date object or Unix timestamp (seconds)
     */
    setDate(value) {
      let date;
      
      if (typeof value === 'number') {
        date = new Date(value * 1000);
      } else if (value instanceof Date) {
        date = value;
      } else {
        return;
      }

      this.selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      this.viewDate = new Date(this.selectedDate);
      this.selectedHours = date.getHours();
      this.selectedMinutes = date.getMinutes();

      this._updateDropdown();
      this._updateInputValue();
      this._triggerChange();
    }

    /**
     * Destroy the picker and clean up
     */
    destroy() {
      document.removeEventListener('click', this._onDocumentClick);
      document.removeEventListener('keydown', this._onKeyDown);
      this.options.container.innerHTML = '';
    }
  }

  // Export to global scope
  global.SFSPDateTimePicker = SFSPDateTimePicker;

})(typeof window !== 'undefined' ? window : this);
