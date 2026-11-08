# Preserve historical Everee access after classification changes

An enabled former Local driver should retain access to their own verified Everee statements after becoming Desi. Add explicit read-only-history and bank-management capabilities to the driver's setup response. Payment history retains the configured-tenant, live-link, completed-onboarding, signed-agreement and enabled-account checks; only this read-only experience permits a non-Local driver. Onboarding and bank management stay Local-only. No payment or earnings behavior changes.

Validation: 101 selected onboarding, recovery, submission/status, receipt and transfer backend tests passed on a disposable database; 45 focused driver UI tests passed. New tests verify history after reclassification, ignored client-supplied identity, wrong-tenant/disabled refusal and no bank management for Desi. Full device/provider-PDF acceptance remains pending; no production setting or payment changed.
