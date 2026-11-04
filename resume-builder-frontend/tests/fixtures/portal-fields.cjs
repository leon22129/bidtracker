// Reduced controls observed on the supplied Paylocity, Lever, Workable and
// Rippling application pages. Values are fictional; these fixtures never submit.
module.exports = [
  {
    name: 'Paylocity',
    html: `<main><h1>Application</h1><form>
      <label for="country"><span data-automation-id="country-label-span">Country</span>
        <div class="pcty-input-select-full-container" aria-haspopup="listbox" aria-expanded="false">
          <div class="input-select-input-single-value">United States</div><div class="pcty-input-select__input"><input id="country" aria-autocomplete="list" value=""></div>
        </div></label>
      <label for="state"><span>State</span><div class="pcty-input-select-full-container" aria-haspopup="listbox">
        <div>Select a state</div><input id="state" aria-autocomplete="list" value=""></div></label>
      <label><span>How did you hear about us?</span><div role="radiogroup">
        <label><input type="radio" name="source" value="Board"><span>Online Job Board</span></label>
        <label><input type="radio" name="source" value="Referral" checked><span>Friend or Family Member</span></label>
      </div></label>
      <div><label>Have you applied for a job with us before? (required)</label>
        <div role="combobox" class="rw-dropdownlist" aria-owns="previous-options"><div class="rw-input">No</div></div>
        <div id="previous-options" role="listbox"><div role="option" aria-selected="false">Yes</div><div role="option" aria-selected="true">No</div></div>
      </div></form></main>`,
    expected: { Country: 'United States', State: '', 'How did you hear about us?': 'Friend or Family Member', 'Have you applied for a job with us before?': 'No' },
  },
  {
    name: 'Lever',
    html: `<main><h1>Application</h1><form>
      <div class="application-question"><label><div class="application-label">Full name✱</div><input value="Test Candidate"></label></div>
      <div class="application-question"><label><div class="application-label">How did you hear about us?✱</div>
        <select><option value="">Please select the source that led you to apply.</option><option value="website">Company website</option></select></label></div>
      <div class="application-question"><label><div class="application-label">Preferred team✱</div><div class="application-field"><ul>
        <li><label><input type="radio" name="team" value="platform" checked><span class="application-answer-alternative">Platform</span><div class="eeo-option-description">Long explanatory help about this choice.</div></label></li>
        <li><label><input type="radio" name="team" value="product"><span class="application-answer-alternative">Product</span></label></li>
      </ul></div></label></div>
      <div class="application-question"><label><div class="application-label">Resume/CV</div><div class="application-field">
        <a class="visible-resume-upload"><span class="filename"></span><span>Attach resume</span><input id="lever-resume" type="file" style="display:none"></a>
      </div></label></div></form></main>`,
    files: ['lever-resume'],
    expected: { 'Full name': 'Test Candidate', 'How did you hear about us?': '', 'Preferred team': 'Platform', 'Resume/CV': 'candidate.pdf' },
  },
  {
    name: 'Workable',
    html: `<main><h1>Application</h1><form>
      <label id="first_label" for="first">*First name</label><input id="first" aria-labelledby="first_label" value="Test">
      <label id="summary_label" for="summary">Summary (Optional)</label><textarea id="summary">Building useful software.</textarea>
      <label for="phone">Phone</label><div class="iti"><button type="button" aria-haspopup="dialog"><span class="iti__selected-dial-code">+44</span></button><input id="phone" type="tel" value="7700900123"></div>
      <span id="resume_label">Resume</span><div data-role="dropzone"><label id="choose_file" role="button" for="workable-resume">Choose file</label>
        <input id="workable-resume" type="file" aria-labelledby="resume_label choose_file" style="opacity:0"></div>
      </form></main>`,
    files: ['workable-resume'],
    expected: { 'First name': 'Test', Summary: 'Building useful software.', Phone: '+44 7700900123', Resume: 'candidate.pdf' },
  },
  {
    name: 'Rippling',
    html: `<main><h1>Application</h1><form>
      <div data-testid="field"><span id="resume-label">Resume</span><div><span id="file-status" data-testid="screen-reader-only">Total 1 file selected</span>
        <label aria-labelledby="file-status resume-label"><input id="rippling-resume" type="file" style="display:none"><button type="button">Drop or select</button></label></div></div>
      <label id="offices-label">Preferred offices</label><div data-testid="select-controller"><span>London</span><span>Remote</span>
        <div><input role="combobox" aria-labelledby="offices-label" value=""></div></div>
      <div data-testid="phone_number-code"><div data-testid="select-controller"><input role="combobox" aria-label="Search" value="+1 US"></div></div>
      <div class="marginY--36"><div class="paddingX--16"><p>Have you applied before?</p></div>
        <div data-testid="field"><div data-testid="select-controller"><div role="combobox" aria-label="Select"><p>No</p></div></div></div>
      </div></form></main>`,
    files: ['rippling-resume'],
    expected: { Resume: 'candidate.pdf', 'Preferred offices': 'London Remote', 'Phone country code': '+1 US', 'Have you applied before?': 'No' },
  },
  {
    name: 'Enhanced native select',
    html: `<main><h1>Application</h1><form><label for="enhanced-answer">Have you applied before?</label>
      <select id="enhanced-answer" class="select2-hidden-accessible" aria-hidden="true" style="display:none"><option value="">Select one</option><option value="no" selected>No</option></select>
      <span class="select2-container"><span role="combobox" aria-labelledby="select2-enhanced-answer-container"><span id="select2-enhanced-answer-container">No</span></span></span>
      <label for="inactive-answer">Inactive question</label><select id="inactive-answer" hidden><option selected>Stale hidden answer</option></select>
      </form></main>`,
    expected: { 'Have you applied before?': 'No' },
  },
];
