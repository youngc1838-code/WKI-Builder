// Example documents for learning the screens. They are marked isSample: true.
// They load only when this browser has no saved documents yet.

function sampleDocument(fields) {
  return {
    documentType: 'Work Instruction',
    title: '',
    documentNumber: '',
    partNumber: '',
    revision: 'A',
    department: '',
    preparedBy: '',
    reviewer: '',
    effectiveDate: '',
    purpose: '',
    scope: '',
    safety: '',
    toolsMaterials: '',
    references: '',
    status: 'Draft',
    isSample: true,
    revisesId: '',
    basedOnRevision: '',
    updatedAt: '2026-10-01T12:00:00.000Z',
    steps: [],
    ...fields,
  }
}

function sampleStep(id, instruction, toolsOrParts, qualityCheck, safetyNote = '', imageNote = '') {
  return { id, instruction, toolsOrParts, qualityCheck, safetyNote, imageNote }
}

export function sampleDocuments() {
  return [
    sampleDocument({
      id: 'sample-wi-asm-1042',
      documentType: 'Work Instruction',
      title: 'Assemble Coolant Pump Housing',
      documentNumber: 'WI-ASM-1042',
      partNumber: '1042-88 / Pump Housing Family',
      revision: 'C',
      department: 'Assembly',
      preparedBy: 'A. Chen',
      reviewer: 'M. Ortiz',
      effectiveDate: '2026-03-02',
      purpose:
        'Define the accepted method to assemble the coolant pump housing so each unit meets the torque and seal requirements.',
      scope:
        'Applies to part 1042-88 built on Assembly Cell 2. Does not cover motor winding, painting, or field repair.',
      safety:
        'Safety glasses and nitrile gloves. Isolate the seal press before loading a housing. Do not place hands between the platen and the part.',
      toolsMaterials:
        '10 mm hex driver, calibrated torque wrench 5–25 N·m, seal press fixture SP-14, lint-free wipes, O-ring kit 1042-OR.',
      references: 'Drawing 1042-88 Rev D, Torque Specification TS-17, Seal Press Setup WI-ASM-0991.',
      status: 'Released',
      updatedAt: '2026-10-02T14:30:00.000Z',
      steps: [
        sampleStep(
          'sample-wi-asm-1042-s1',
          'Confirm the housing lot tag matches the traveler and that seal kit 1042-OR is the current revision.',
          'Traveler, kit 1042-OR',
          'Write the lot number and kit revision on the traveler before assembly starts.',
          '',
          'Photo of the housing lot tag next to the kit label.',
        ),
        sampleStep(
          'sample-wi-asm-1042-s2',
          'Wipe the seal bore with a lint-free wipe. Press the seal with fixture SP-14 until the seal face is flush.',
          'Lint-free wipes, seal press fixture SP-14',
          'Seal face is flush within 0.2 mm and shows no cuts or folds.',
          'Keep hands clear of the press platen. Do not cycle the press until the fixture is seated.',
          'Cross-section showing a correctly seated seal.',
        ),
        sampleStep(
          'sample-wi-asm-1042-s3',
          'Fit the cover O-ring without a twist. Torque the six M6 cover screws to 12 N·m in the star pattern on drawing 1042-88.',
          '10 mm hex driver, calibrated torque wrench 5–25 N·m',
          'Each screw reads 12 N·m ± 1. Record the wrench ID on the traveler.',
          '',
          'Star-pattern torque sequence from drawing 1042-88.',
        ),
      ],
    }),
    sampleDocument({
      id: 'sample-sop-qa-2201',
      documentType: 'SOP',
      title: 'First-Article Inspection for Machined Housings',
      documentNumber: 'SOP-QA-2201',
      partNumber: 'BRG-200 housing family',
      revision: 'B',
      department: 'Quality',
      preparedBy: 'R. Patel',
      reviewer: 'L. Nguyen',
      effectiveDate: '2026-10-20',
      purpose:
        'Describe how Quality inspects the first machined housing in a lot before production is allowed to continue.',
      scope:
        'Applies to BRG-200 family housings from the CNC cell. Does not replace the in-process checks on later pieces.',
      safety:
        'Safety glasses. Deburr edges before handling. Do not lift a housing by the bearing bore.',
      toolsMaterials:
        'Calibrated micrometer 0–25 mm, bore gage, surface plate, drawing balloon list FA-2201, first-article form QF-14.',
      references: 'Drawing BRG-200-11 Rev F, Sampling procedure SOP-QA-1104, Calibration log CAL-08.',
      status: 'In Review',
      updatedAt: '2026-10-10T16:10:00.000Z',
      steps: [
        sampleStep(
          'sample-sop-qa-2201-s1',
          'Confirm the setup sheet, program number, and material cert match the work order before measuring the part.',
          'Work order, setup sheet, material cert',
          'All three identifiers match. Stop and notify the supervisor if any identifier differs.',
          '',
          'Photo of the work order header and setup sheet.',
        ),
        sampleStep(
          'sample-sop-qa-2201-s2',
          'Measure the ballooned characteristics on form QF-14. Record the actual value, gage ID, and pass or fail for each row.',
          'Micrometer, bore gage, form QF-14',
          'Every balloon on drawing BRG-200-11 has a recorded result. Blank rows are not allowed.',
          'Deburr the handling edges before placing the housing on the surface plate.',
          'Example of a completed QF-14 row.',
        ),
        sampleStep(
          'sample-sop-qa-2201-s3',
          'Tag the part as first-article hold. Release the lot only after the reviewer signs form QF-14.',
          'Hold tag, form QF-14',
          'The signed form is filed with the lot traveler before the next piece is run.',
          '',
          'Hold-tag location on the housing flange.',
        ),
      ],
    }),
    sampleDocument({
      id: 'sample-wi-mch-3310',
      documentType: 'Work Instruction',
      title: 'CNC Setup for Bearing Bore',
      documentNumber: 'WI-MCH-3310',
      partNumber: 'BRG-200',
      revision: 'A',
      department: 'Machining',
      preparedBy: 'J. Okonkwo',
      reviewer: '',
      effectiveDate: '',
      purpose:
        'Set up the horizontal mill so the bearing bore is bored to the diameter and true position on drawing BRG-200-11.',
      scope:
        'Applies to the first setup of the day on Mill 4 for the BRG-200 family. The operator still follows the in-process check sheet after setup.',
      safety:
        'Safety glasses and steel-toe shoes. Verify the spindle is at zero and the tool changer is clear before loading the boring bar.',
      toolsMaterials:
        'Boring bar B-42, 0–25 mm bore gage, soft jaws SJ-200, program O3310, setup sheet SS-3310.',
      references: 'Drawing BRG-200-11 Rev F, Program O3310, Machine warmup SOP-MCH-1002.',
      status: 'Draft',
      updatedAt: '2026-10-12T13:45:00.000Z',
      steps: [
        sampleStep(
          'sample-wi-mch-3310-s1',
          'Load soft jaws SJ-200 and indicate the bore center within 0.02 mm before setting the work offset.',
          'Soft jaws SJ-200, dial indicator',
          'Indicator sweep of the bore is within 0.02 mm. Record the offset on the setup sheet.',
          'Keep hands out of the work envelope while the axis is jogging.',
          'Indicator setup on the bore.',
        ),
        sampleStep(
          'sample-wi-mch-3310-s2',
          'Install boring bar B-42, run program O3310 on the prove-out part, and measure the bore before running the lot.',
          'Boring bar B-42, bore gage, program O3310',
          'Bore diameter is 42.00 mm +0.02 / 0. Record the gage ID.',
          'Do not reach in to clear chips while the spindle is turning.',
          'Bore gage in the finished bore.',
        ),
      ],
    }),
    sampleDocument({
      id: 'sample-sop-mfg-1008',
      documentType: 'SOP',
      title: 'Hand Deburr of Aluminum Covers',
      documentNumber: 'SOP-MFG-1008',
      partNumber: 'CVR-440 cover family',
      revision: 'A',
      department: 'Finishing',
      preparedBy: 'S. Alvarez',
      reviewer: 'M. Ortiz',
      effectiveDate: '2024-11-15',
      purpose:
        'Old method for hand deburr of aluminum covers. Superseded by the vibratory finish method in SOP-MFG-1140. Kept here so the old revision can still be read.',
      scope: 'Previously applied to CVR-440 covers before vibratory finishing was released. Do not use for new lots.',
      safety: 'Cut-resistant gloves and safety glasses. Point the blade away from the body and from other people.',
      toolsMaterials: 'Deburr blade DB-2, edge break gage, nylon brush.',
      references: 'Drawing CVR-440 Rev B. Superseded by SOP-MFG-1140.',
      status: 'Obsolete',
      updatedAt: '2026-06-01T11:00:00.000Z',
      steps: [
        sampleStep(
          'sample-sop-mfg-1008-s1',
          'Break the outer edges with blade DB-2 until the edge break is 0.2 to 0.4 mm.',
          'Deburr blade DB-2, edge break gage',
          'Edge break is within 0.2 to 0.4 mm on all outer edges.',
          'Cut-resistant gloves. Keep the blade path pointed away from the hand holding the cover.',
          'Acceptable edge break on the cover flange.',
        ),
      ],
    }),
  ]
}
