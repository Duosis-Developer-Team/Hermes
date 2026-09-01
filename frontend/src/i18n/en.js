/**
 * =============================================================================
 * HERMES - Ingilizce sozluk (KAYNAK dil)
 * =============================================================================
 * Bu dosya arayuzun DOGRU metnidir; `tr.js` bunu takip eder. Bir anahtar
 * burada yoksa hicbir yerde yoktur — once buraya eklenir.
 *
 * Anahtarlar EKRANA gore gruplanir (nav, common, tickets, ...), dosyaya
 * gore DEGIL: ayni metin iki ekranda geciyorsa tek anahtar kullanilir.
 */

export default {
    // ---------------------------------------------------------------
    // Kabuk: gezinme, tema, dil
    // ---------------------------------------------------------------
    nav: {
        dashboard: 'Dashboard',
        billableHours: 'Billable Hours',
        reports: 'Reports',
        contractStatus: 'Contract Status',
        pmConfigurations: 'PM Configurations',
        apiManagement: 'API Management',
        ticketIntegrations: 'Ticket Integrations',
        customers: 'Customers',
        projects: 'Projects',
        workTypes: 'Work Types',
        activityTypes: 'Activity Types',
        platforms: 'Platforms',
        workLines: 'Work Lines',
        users: 'Users',
        timeEntry: 'Time Entry',
        projectManagement: 'Project Management',
        meetings: 'Meetings',
        developer: 'Developer',
        tickets: 'Tickets',
        support: 'Support',
        groupManagement: 'MANAGEMENT',
        groupConfiguration: 'CONFIGURATION',
        logout: 'Logout',
    },

    shell: {
        switchToDark: 'Switch to dark theme',
        switchToLight: 'Switch to light theme',
        language: 'Language',
        switchToTurkish: 'Switch to Turkish',
        switchToEnglish: 'Switch to English',
    },

    // ---------------------------------------------------------------
    // Her ekranda tekrar eden metinler
    // ---------------------------------------------------------------
    common: {
        save: 'Save',
        cancel: 'Cancel',
        create: 'Create',
        edit: 'Edit',
        delete: 'Delete',
        close: 'Close',
        submit: 'Submit',
        confirm: 'Confirm',
        search: 'Search',
        clear: 'Clear',
        refresh: 'Refresh',
        loading: 'Loading…',
        actions: 'Actions',
        status: 'Status',
        name: 'Name',
        description: 'Description',
        active: 'Active',
        inactive: 'Inactive',
        yes: 'Yes',
        no: 'No',
        all: 'All',
        none: 'None',
        required: 'This field is required',
        saved: 'Saved',
        created: 'Created',
        updated: 'Updated',
        deleted: 'Deleted',
        genericError: 'Something went wrong. Please try again.',
        retry: 'Retry',
    },
    // ---------------------------------------------------------------
    // Giris
    // ---------------------------------------------------------------
    login: {
        signInToHermes: 'Sign in to Hermes',
        email: 'Email',
        password: 'Password',
        emailPlaceholder: 'you@company.com',
        passwordPlaceholder: 'Enter your password',
        signIn: 'Sign In',
        signInWithMicrosoft: 'Sign in with Microsoft',
        microsoftHint: 'Use your Microsoft work account to continue',
        loginSuccess: 'Login successful!',
        signedInToPlatform: 'Signed in to Platform Administration',
        emailRequired: 'Please enter your email',
        emailInvalid: 'Please enter a valid email address',
        passwordRequired: 'Please enter your password',
        azureMisconfigured: 'Azure Client ID is missing from the web configuration',
        toggleTheme: 'Toggle light and dark mode',
    },

    // ---------------------------------------------------------------
    // Zaman girisi
    // ---------------------------------------------------------------
    timeEntry: {
        timeLogged: 'Time logged',
        timeUpdated: 'Time updated',
        logEntryDeleted: 'Log entry deleted successfully',
        planUpdated: 'Plan updated',
        planDeleted: 'Plan deleted',
        deletePlan: 'Delete Plan',
        deletePlanFailed: 'Failed to delete plan',
        confirmDeletion: 'Confirm Deletion',
        cannotBeUndone: 'This action cannot be undone',
        assignmentsWillBeRemoved: 'All assignments will be removed',
        selectTargetDay: 'Select a target day first, then paste',
        reportDownloaded: 'Weekly report (CSV) downloaded',
        reportFailed: 'Failed to download report',
        meetingInviteSent: 'Meeting invite sent',
        respondFailed: 'Failed to respond',
    },

    // ---------------------------------------------------------------
    // Gorevler / toplantilar / panel
    // ---------------------------------------------------------------
    tasks: {
        filters: 'Filters',
        noAccess: 'You do not have access to the Tasks module.',
        statusNotAllowed: 'You are not allowed to change this task status.',
    },

    meetings: {
        previousWeek: 'Previous week',
        nextWeek: 'Next week',
        today: 'Today',
        allUsers: 'All users',
        noMeetings: 'No meetings for this week.',
    },

    dashboard: {
        title: 'Dashboard',
        subtitle: 'Team performance and time distribution',
        summaryMetrics: 'Summary metrics',
        totalHours: 'Total Hours',
        activeMembers: 'Active Members',
        customers: 'Customers',
        projects: 'Projects',
        byUser: 'By User',
        byCustomer: 'By Customer',
        byProject: 'By Project',
        previousMonth: 'Previous month',
        nextMonth: 'Next month',
        today: 'Today',
    },

    billableHours: {
        title: 'Billable Hours',
        subtitle: 'Manage user billable time entries',
        selectUser: 'Select user',
        currentWeek: 'Current Week',
        previousWeek: 'Previous week',
        nextWeek: 'Next week',
        save: 'Save billable hours',
        hoursUpdated: 'Hours updated',
        minuteIncrement: 'Minutes must be in increments of 15 (0, 15, 30, 45).',
        accessDenied: 'Access Denied',
    },
}
