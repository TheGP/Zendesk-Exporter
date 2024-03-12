# Zendesk Exporter

This project is a tool for exporting data from Zendesk, including tickets, comments, users, views, triggers, macros, automations, settings, and support addresses.

## About the Project

The Zendesk Exporter allows users to export various data from their Zendesk instance for backup, analysis, or migration purposes. It provides functions to retrieve tickets, comments, users, views, triggers, macros, automations, settings, and support addresses, and export them into JSON files.

## Getting Started

### Prerequisites

Before running the project, ensure you have the following prerequisites installed:

- Node.js
- npm (Node Package Manager)

### Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/TheGP/Zendesk-Exporter.git
   ```

2. Navigate to the project directory:
   ```sh
   cd zendesk-exporter
   ```

3. Install dependencies:
   ```sh
   npm install
   ```

## Usage

To export data from Zendesk, follow these steps:

1. Set up your Zendesk API credentials by creating a `.env` file in the root directory of the project and adding your Zendesk email and token:
   ```plaintext
   ZENDESK_API=https://yourdomain.zendesk.com/api/v2/
   ZENDESK_EMAIL=your-email@example.com
   ZENDESK_TOKEN=your-zendesk-token
   ```

2. Run the export script:
   ```sh
   npm start
   ```

This will start the export process, fetching data from Zendesk API and saving it into JSON files in the `exported` directory.

## Contributing

Contributions are welcome! Please follow these steps to contribute to the project:

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/your-feature`).
3. Make changes and commit them (`git commit -am 'Add your feature'`).
4. Push to the branch (`git push origin feature/your-feature`).
5. Create a new pull request.

## License

This project is licensed under the MIT License
