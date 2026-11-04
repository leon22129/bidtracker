// Reduced public application DOM patterns, with fictional questions/answers.
// Inspected jobs.ashbyhq.com/ashby and job-boards.greenhouse.io/counterpart.
const ashby = `<main><h1>Engineer</h1><form class="ashby-application-form-container">
  <div class="ashby-application-form-field-entry"><label for="ashby-name" class="ashby-application-form-question-title">Name</label>
    <div><input id="ashby-name" value="Test Candidate"></div></div>
  <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title">Have you applied before?</label>
    <div id="ashby-yesno" class="ashby-application-form-input-yesno">
      <button type="button" aria-pressed="false" data-option="yes">Yes</button><button type="button" aria-pressed="true" data-option="no">No</button>
      <input type="checkbox" name="previous-application" style="display:none"></div></div>
  <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title">Can you relocate?</label>
    <div class="ashby-application-form-input-yesno">
      <button type="button" aria-pressed="false" data-option="yes">Yes</button><button type="button" aria-pressed="false" data-option="no">No</button>
      <input type="checkbox" name="relocate" style="display:none"></div></div>
  <fieldset class="ashby-application-form-input-radio-group"><label class="ashby-application-form-question-title">Preferred work schedule</label>
    <div><span><input type="radio" id="schedule-full" name="schedule" checked style="opacity:0"></span><label for="schedule-full">Full time</label></div>
    <div><span><input type="radio" id="schedule-part" name="schedule" style="opacity:0"></span><label for="schedule-part">Part time</label></div></fieldset>
  <fieldset class="ashby-application-form-input-checkbox-group"><label class="ashby-application-form-question-title">Preferred offices</label>
    <div><span><input type="checkbox" id="office-london" name="London" checked style="opacity:0"></span><label for="office-london">London</label></div>
    <div><span><input type="checkbox" id="office-remote" name="Remote" checked style="opacity:0"></span><label for="office-remote">Remote</label></div></fieldset>
  <div class="ashby-application-form-field-entry"><label for="ashby-why" class="ashby-application-form-question-title">Why this role?</label>
    <textarea id="ashby-why">I enjoy building reliable systems.</textarea></div>
  <button type="submit">Submit Application</button>
  </form></main>`;

const greenhouse = `<main><h1>Engineer</h1><form id="application_form">
  <h2>Apply for this job</h2>
  <div class="input-wrapper"><label for="first_name">First Name<span aria-hidden="true">*</span></label><input id="first_name" value="Test"></div>
  <div class="select"><div class="select__container"><label id="gh-question-label" for="gh-question" class="label select__label">Have you applied before?</label>
    <div class="select-shell"><span role="log" aria-live="polite">No, selected.</span>
      <div class="select__control"><div class="select__value-container"><div class="select__single-value">No</div>
        <div class="select__input-container"><input id="gh-question" role="combobox" aria-labelledby="gh-question-label" value=""></div>
      </div></div><input aria-hidden="true" tabindex="-1" value="no"></div></div></div>
  <fieldset class="checkbox"><legend>Preferred teams</legend>
    <div><input id="team-platform" type="checkbox" name="teams[]" value="123" checked><label for="team-platform">Platform</label></div>
    <div><input id="team-product" type="checkbox" name="teams[]" value="456"><label for="team-product">Product</label></div></fieldset>
  <label>Why this role?<textarea>I enjoy building reliable systems.</textarea></label>
  <button type="submit">Submit application</button>
  </form></main>`;

module.exports = { ashby, greenhouse };
